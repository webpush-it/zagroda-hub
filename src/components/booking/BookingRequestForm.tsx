import React, { useState } from "react";
import { Calendar, CircleAlert, CircleCheck, Loader2, Mail, Phone, Send, User, Users } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";
import { bookingRequestSchema, fieldErrorsFromZod } from "@/lib/booking";

interface TurnusOption {
  id: string;
  label: string;
  time: string;
}

interface Props {
  zagrodaId: string;
  turnusy: TurnusOption[];
  /** Display hint only — the daily limit is enforced at owner-accept, not here. */
  dailyLimit?: number;
}

interface SubmitResponse {
  ok?: boolean;
  fieldErrors?: Record<string, string>;
  error?: string;
}

const inputBase =
  "w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:outline-none focus:ring-2";

function fieldClass(error?: string) {
  return cn(inputBase, error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400");
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
      <CircleAlert className="size-3 shrink-0" />
      {message}
    </p>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function BookingRequestForm({ zagrodaId, turnusy, dailyLimit }: Props) {
  const [turnusId, setTurnusId] = useState("");
  const [tripDate, setTripDate] = useState("");
  const [participants, setParticipants] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

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
      guest_name: name,
      guest_email: email,
      guest_phone: phone,
    };
    const parsed = bookingRequestSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await fetch("/api/booking-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = (await res.json()) as SubmitResponse;
      if (res.status === 422 && data.fieldErrors) {
        setFieldErrors(data.fieldErrors);
      } else if (!res.ok || !data.ok) {
        setServerError(data.error ?? "Nie udało się wysłać zapytania — spróbuj ponownie");
      } else {
        setSent(true);
      }
    } catch {
      setServerError("Błąd połączenia — spróbuj ponownie");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    void submit();
  }

  if (sent) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-green-400/30 bg-green-400/10 px-3 py-3 text-sm text-green-200">
        <CircleCheck className="mt-0.5 size-4 shrink-0" />
        Zapytanie wysłane — sprawdź e-mail, znajdziesz tam link do anulowania.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <h2 className="text-base font-semibold text-white">Wyślij zapytanie</h2>

      <div>
        <label htmlFor="turnus_id" className="mb-1 block text-sm text-blue-100/80">
          Turnus
        </label>
        <select
          id="turnus_id"
          value={turnusId}
          onChange={(e) => {
            setTurnusId(e.target.value);
            clearError("turnus_id");
          }}
          className={cn(fieldClass(fieldErrors.turnus_id || undefined), "appearance-none")}
        >
          <option value="" className="bg-slate-900">
            — wybierz turnus —
          </option>
          {turnusy.map((t) => (
            <option key={t.id} value={t.id} className="bg-slate-900">
              {t.label} ({t.time})
            </option>
          ))}
        </select>
        <FieldError message={fieldErrors.turnus_id || undefined} />
      </div>

      <div>
        <label htmlFor="trip_date" className="mb-1 block text-sm text-blue-100/80">
          Data pobytu
        </label>
        <div className="relative">
          <span className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40">
            <Calendar className="size-4" />
          </span>
          <input
            id="trip_date"
            type="date"
            min={today()}
            value={tripDate}
            onChange={(e) => {
              setTripDate(e.target.value);
              clearError("trip_date");
            }}
            className={cn(fieldClass(fieldErrors.trip_date || undefined), "pl-10")}
          />
        </div>
        <FieldError message={fieldErrors.trip_date || undefined} />
      </div>

      <FormField
        id="participants_count"
        type="number"
        label="Liczba uczestników"
        value={participants}
        onChange={(v) => {
          setParticipants(v);
          clearError("participants_count");
        }}
        placeholder={dailyLimit ? `np. ${Math.min(dailyLimit, 40)}` : "np. 25"}
        error={fieldErrors.participants_count || undefined}
        icon={<Users className="size-4" />}
        hint={
          dailyLimit ? (
            <p className="mt-1 text-xs text-blue-100/50">Dzienny limit gospodarza: {dailyLimit}</p>
          ) : undefined
        }
      />

      <FormField
        id="guest_name"
        label="Imię i nazwisko"
        value={name}
        onChange={(v) => {
          setName(v);
          clearError("guest_name");
        }}
        placeholder="np. Anna Kowalska"
        error={fieldErrors.guest_name || undefined}
        icon={<User className="size-4" />}
      />

      <FormField
        id="guest_email"
        type="email"
        label="E-mail"
        value={email}
        onChange={(v) => {
          setEmail(v);
          clearError("guest_email");
        }}
        placeholder="ty@example.com"
        error={fieldErrors.guest_email || undefined}
        icon={<Mail className="size-4" />}
      />

      <FormField
        id="guest_phone"
        type="tel"
        label="Telefon"
        value={phone}
        onChange={(v) => {
          setPhone(v);
          clearError("guest_phone");
        }}
        placeholder="np. 600 700 800"
        error={fieldErrors.guest_phone || undefined}
        icon={<Phone className="size-4" />}
      />

      <ServerError message={serverError} />

      <button
        type="submit"
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-3 font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
      >
        {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        {submitting ? "Wysyłanie…" : "Wyślij zapytanie"}
      </button>
    </form>
  );
}
