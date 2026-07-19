import React, { useState } from "react";
import { Calendar, ChevronDown, CircleAlert, Loader2, Phone, Plus, Users } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";
import { manualBookingSchema, fieldErrorsFromZod } from "@/lib/booking";

// S-08 FR-021: owner records a phone booking from /dashboard/zapytania.
// Collapsible expand-in-place (no modal) so the form is one tap away — the
// <15 s one-handed NFR. Success does a full page reload: the SSR list is the
// server truth, matching the repo's no-client-cache posture.

interface TurnusOption {
  id: string;
  label: string;
  time: string;
}

interface Props {
  zagrodaId: string;
  turnusy: TurnusOption[];
}

interface SubmitResponse {
  ok?: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
  error?: string;
}

function fieldClass(error?: string) {
  return cn("input-field", error && "border-red-500 focus:border-red-500");
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-red-700">
      <CircleAlert className="size-3 shrink-0" />
      {message}
    </p>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ManualBookingForm({ zagrodaId, turnusy }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [turnusId, setTurnusId] = useState("");
  const [tripDate, setTripDate] = useState("");
  const [participants, setParticipants] = useState("");
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function clearError(field: string) {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: "" }));
  }

  async function submit() {
    setServerError(null);

    const payload = {
      zagroda_id: zagrodaId,
      turnus_id: turnusId,
      trip_date: tripDate,
      participants_count: participants.trim() === "" ? Number.NaN : Number(participants),
      note: note.trim() === "" ? undefined : note,
    };
    const parsed = manualBookingSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await fetch("/api/manual-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = (await res.json()) as SubmitResponse;
      if (res.status === 422 && data.fieldErrors) {
        setFieldErrors(data.fieldErrors);
        setSubmitting(false);
      } else if (!res.ok || !data.ok) {
        // 409s carry the domain copy: FR-014 over-limit X/Y/Z or day_blocked.
        setServerError(data.error ?? "Nie udało się dodać rezerwacji — spróbuj ponownie");
        setSubmitting(false);
      } else {
        window.location.reload();
      }
    } catch {
      setServerError("Błąd połączenia — spróbuj ponownie");
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    void submit();
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
        }}
        className="btn-primary w-full"
      >
        <Phone className="size-4" />
        Dodaj rezerwację telefoniczną
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border-edge bg-surface space-y-4 rounded-xl border p-4" noValidate>
      <button
        type="button"
        onClick={() => {
          setExpanded(false);
        }}
        className="tap-target text-ink flex w-full items-center justify-between text-base font-semibold"
        aria-expanded="true"
      >
        Nowa rezerwacja telefoniczna
        <ChevronDown className="text-ink-muted size-4 rotate-180" aria-hidden="true" />
      </button>

      <div>
        <label htmlFor="manual_trip_date" className="text-ink-muted mb-1 block text-sm">
          Data pobytu
        </label>
        <div className="relative">
          <span className="text-ink-muted absolute top-1/2 left-3 size-4 -translate-y-1/2">
            <Calendar className="size-4" />
          </span>
          <input
            id="manual_trip_date"
            type="date"
            min={today()}
            value={tripDate}
            onChange={(e) => {
              setTripDate(e.target.value);
              clearError("trip_date");
            }}
            className={cn(fieldClass(fieldErrors.trip_date || undefined), "pl-10!")}
          />
        </div>
        <FieldError message={fieldErrors.trip_date || undefined} />
      </div>

      <div>
        <label htmlFor="manual_turnus_id" className="text-ink-muted mb-1 block text-sm">
          Turnus
        </label>
        <select
          id="manual_turnus_id"
          value={turnusId}
          onChange={(e) => {
            setTurnusId(e.target.value);
            clearError("turnus_id");
          }}
          className={cn(fieldClass(fieldErrors.turnus_id || undefined), "appearance-none")}
        >
          <option value="">— wybierz turnus —</option>
          {turnusy.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({t.time})
            </option>
          ))}
        </select>
        <FieldError message={fieldErrors.turnus_id || undefined} />
      </div>

      <FormField
        id="manual_participants_count"
        type="number"
        label="Liczba uczestników"
        value={participants}
        onChange={(v) => {
          setParticipants(v);
          clearError("participants_count");
        }}
        placeholder="np. 25"
        error={fieldErrors.participants_count || undefined}
        icon={<Users className="size-4" />}
      />

      <div>
        <label htmlFor="manual_note" className="text-ink-muted mb-1 block text-sm">
          Notatka (opcjonalnie)
        </label>
        <textarea
          id="manual_note"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            clearError("note");
          }}
          rows={3}
          maxLength={500}
          placeholder="np. Pani Kowalska, SP 5 w Krakowie, tel. 600 700 800"
          className={fieldClass(fieldErrors.note || undefined)}
        />
        <FieldError message={fieldErrors.note || undefined} />
      </div>

      <ServerError message={serverError} />

      <button type="submit" disabled={submitting} className="btn-primary w-full">
        {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {submitting ? "Dodawanie…" : "Dodaj rezerwację"}
      </button>
    </form>
  );
}
