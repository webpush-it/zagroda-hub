import React, { useState } from "react";
import { Calendar, CalendarOff, ChevronDown, CircleAlert, Loader2, Lock, LockOpen } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";
import { dayBlockSchema, fieldErrorsFromZod } from "@/lib/booking";

// S-08 FR-022/FR-023: block ("dzień wolny") and unblock whole days from
// /dashboard/zapytania. Same posture as ManualBookingForm: expand-in-place,
// no modal, full page reload on success (SSR block list is the server truth).
// Unblock uses the inline expand-to-confirm pattern from RequestDecision.

interface Props {
  zagrodaId: string;
  /** Active blocks (blocked_date >= today, ascending) from SSR — no client fetching. */
  blocks: { blocked_date: string }[];
}

interface SubmitResponse {
  ok?: boolean;
  fieldErrors?: Record<string, string>;
  error?: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function DayBlocks({ zagrodaId, blocks }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [blockedDate, setBlockedDate] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingUnblock, setConfirmingUnblock] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState<string | null>(null);
  const [unblockError, setUnblockError] = useState<string | null>(null);

  async function block() {
    setServerError(null);

    const parsed = dayBlockSchema.safeParse({ zagroda_id: zagrodaId, blocked_date: blockedDate });
    if (!parsed.success) {
      setFieldError(fieldErrorsFromZod(parsed.error).blocked_date);
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/day-block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = (await res.json()) as SubmitResponse;
      if (res.status === 422 && data.fieldErrors?.blocked_date) {
        setFieldError(data.fieldErrors.blocked_date);
        setSubmitting(false);
      } else if (!res.ok || !data.ok) {
        setServerError(data.error ?? "Nie udało się zablokować dnia — spróbuj ponownie");
        setSubmitting(false);
      } else {
        window.location.reload();
      }
    } catch {
      setServerError("Błąd połączenia — spróbuj ponownie");
      setSubmitting(false);
    }
  }

  async function unblock(date: string) {
    setUnblockError(null);
    setUnblocking(date);
    try {
      const res = await fetch("/api/day-block", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zagroda_id: zagrodaId, blocked_date: date }),
      });
      const data = (await res.json()) as SubmitResponse;
      if (res.ok && data.ok) {
        window.location.reload();
        return;
      }
      // 404 soft outcome (removed in another tab) — a reload shows the truth.
      setUnblockError(data.error ?? "Nie udało się odblokować dnia — spróbuj ponownie");
    } catch {
      setUnblockError("Błąd połączenia — spróbuj ponownie");
    }
    setUnblocking(null);
    setConfirmingUnblock(null);
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    void block();
  }

  return (
    <div className="space-y-3">
      {expanded ? (
        <form onSubmit={handleSubmit} className="border-edge bg-surface space-y-4 rounded-xl border p-4" noValidate>
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
            }}
            className="tap-target text-ink flex w-full items-center justify-between text-base font-semibold"
            aria-expanded="true"
          >
            Zablokuj dzień
            <ChevronDown className="text-ink-muted size-4 rotate-180" aria-hidden="true" />
          </button>

          <p className="text-ink-muted text-sm">
            Zablokowany dzień nie przyjmuje nowych zapytań ani akceptacji. Istniejące rezerwacje pozostają bez zmian.
          </p>

          <div>
            <label htmlFor="blocked_date" className="text-ink-muted mb-1 block text-sm">
              Data
            </label>
            <div className="relative">
              <span className="text-ink-muted absolute top-1/2 left-3 size-4 -translate-y-1/2">
                <Calendar className="size-4" />
              </span>
              <input
                id="blocked_date"
                type="date"
                min={today()}
                value={blockedDate}
                onChange={(e) => {
                  setBlockedDate(e.target.value);
                  setFieldError(null);
                }}
                className={cn("input-field pl-10!", fieldError && "border-red-500 focus:border-red-500")}
              />
            </div>
            {fieldError && (
              <p className="mt-1 flex items-center gap-1 text-xs text-red-700">
                <CircleAlert className="size-3 shrink-0" />
                {fieldError}
              </p>
            )}
          </div>

          <ServerError message={serverError} />

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
            {submitting ? "Blokowanie…" : "Zablokuj dzień"}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
          }}
          className="btn-secondary w-full"
        >
          <CalendarOff className="size-4" />
          Zablokuj dzień
        </button>
      )}

      {blocks.length > 0 && (
        <section aria-label="Zablokowane dni" className="space-y-2">
          <h2 className="text-ink-muted text-sm font-medium">Zablokowane dni</h2>
          <ul className="flex flex-col gap-2">
            {blocks.map((b) => (
              <li key={b.blocked_date}>
                {confirmingUnblock === b.blocked_date ? (
                  <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-100 p-3">
                    <p className="text-sm text-amber-900">
                      Odblokować {b.blocked_date}? Dzień znów zacznie przyjmować zapytania.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void unblock(b.blocked_date)}
                        disabled={unblocking !== null}
                        className="btn-primary flex-1"
                      >
                        {unblocking === b.blocked_date ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <LockOpen className="size-4" />
                        )}
                        {unblocking === b.blocked_date ? "Odblokowywanie…" : "Tak, odblokuj"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingUnblock(null);
                        }}
                        disabled={unblocking !== null}
                        className="btn-secondary flex-1 disabled:opacity-50"
                      >
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="border-edge bg-surface flex items-center justify-between gap-2 rounded-lg border py-1 pr-1 pl-3">
                    <span className="text-ink flex min-w-0 items-center gap-2 text-sm font-medium">
                      <CalendarOff className="text-ink-muted size-3.5 shrink-0" aria-hidden="true" />
                      {b.blocked_date}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setUnblockError(null);
                        setConfirmingUnblock(b.blocked_date);
                      }}
                      className="tap-target text-link hover:text-link-hover shrink-0 rounded-lg px-3 text-sm font-medium transition-colors hover:underline"
                    >
                      Odblokuj
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <ServerError message={unblockError} />
        </section>
      )}
    </div>
  );
}
