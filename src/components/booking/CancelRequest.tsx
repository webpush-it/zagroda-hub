import React, { useState } from "react";
import { CircleAlert, CircleCheck, Loader2, Phone, X } from "lucide-react";

interface Props {
  token: string;
}

type CancelStatus = "cancelled" | "already_accepted" | "already_cancelled" | "not_found";

interface CancelResponse {
  status?: CancelStatus;
  error?: string;
}

// Each terminal outcome the RPC can produce maps to one card. The guest already
// has request context from the e-mail they clicked, so copy stays generic.
const OUTCOMES: Record<CancelStatus, { tone: "ok" | "info" | "error"; title: string; body: string }> = {
  cancelled: {
    tone: "ok",
    title: "Zapytanie anulowane",
    body: "Twoje zapytanie zostało anulowane. Gospodarz nie będzie się z Tobą kontaktować w tej sprawie.",
  },
  already_accepted: {
    tone: "info",
    title: "Zapytanie zaakceptowane",
    body: "To zapytanie zostało już zaakceptowane — zadzwoń do gospodarza, aby je odwołać.",
  },
  already_cancelled: {
    tone: "info",
    title: "Już anulowane",
    body: "To zapytanie zostało już wcześniej anulowane.",
  },
  not_found: {
    tone: "error",
    title: "Nieprawidłowy link",
    body: "Link nieprawidłowy lub zapytanie nie istnieje.",
  },
};

const TONE_CLASS: Record<"ok" | "info" | "error", string> = {
  ok: "border-green-400/30 bg-green-400/10 text-green-200",
  info: "border-blue-400/30 bg-blue-400/10 text-blue-100",
  error: "border-red-400/30 bg-red-900/30 text-red-300",
};

function OutcomeIcon({ tone }: { tone: "ok" | "info" | "error" }) {
  if (tone === "ok") return <CircleCheck className="mt-0.5 size-5 shrink-0" />;
  if (tone === "error") return <CircleAlert className="mt-0.5 size-5 shrink-0" />;
  return <Phone className="mt-0.5 size-5 shrink-0" />;
}

export default function CancelRequest({ token }: Props) {
  const [result, setResult] = useState<CancelStatus | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    setServerError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/booking-request/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json()) as CancelResponse;
      if (!res.ok || !data.status) {
        setServerError(data.error ?? "Nie udało się anulować zapytania — spróbuj ponownie.");
      } else {
        setResult(data.status);
      }
    } catch {
      setServerError("Błąd połączenia — spróbuj ponownie.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const outcome = OUTCOMES[result];
    return (
      <div className={`flex items-start gap-2 rounded-lg border px-4 py-4 text-sm ${TONE_CLASS[outcome.tone]}`}>
        <OutcomeIcon tone={outcome.tone} />
        <span>
          <strong className="block">{outcome.title}</strong>
          {outcome.body}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {serverError && (
        <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300">
          <CircleAlert className="size-4 shrink-0" />
          {serverError}
        </p>
      )}
      <button
        type="button"
        onClick={() => void confirm()}
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-3 font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
      >
        {submitting ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
        {submitting ? "Anulowanie…" : "Tak, anuluj zapytanie"}
      </button>
      <a href="/katalog" className="block text-center text-sm text-purple-300 transition-colors hover:text-purple-100">
        Nie, wróć do katalogu
      </a>
    </div>
  );
}
