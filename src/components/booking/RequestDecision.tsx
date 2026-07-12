import React, { useState } from "react";
import { Check, CircleAlert, CircleCheck, Loader2, TriangleAlert, Undo2, X } from "lucide-react";
import { StatusBadge, type RequestStatus } from "@/components/booking/StatusBadge";

interface Props {
  id: string;
  initialStatus: RequestStatus;
}

interface DecisionResponse {
  ok?: boolean;
  status?: string;
  error?: string;
  occupied?: number;
  daily_limit?: number;
  requested?: number;
}

type Action = "accept" | "reject" | "withdraw";

const ACTION_RESULT: Record<Action, { status: RequestStatus; notice: "accepted" | "rejected" | "withdrawn" }> = {
  accept: { status: "accepted", notice: "accepted" },
  reject: { status: "rejected", notice: "rejected" },
  withdraw: { status: "withdrawn_by_owner", notice: "withdrawn" },
};

type Notice =
  | { kind: "accepted" }
  | { kind: "rejected" }
  | { kind: "withdrawn" }
  | { kind: "blocked"; message: string } // over limit — request stays pending, buttons stay active
  | { kind: "stale"; message: string } // status changed elsewhere — prompt a refresh
  | { kind: "error"; message: string };

export default function RequestDecision({ id, initialStatus }: Props) {
  const [status, setStatus] = useState<RequestStatus>(initialStatus);
  const [submitting, setSubmitting] = useState<Action | null>(null);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function decide(action: Action) {
    setNotice(null);
    setSubmitting(action);
    try {
      const res = await fetch(`/api/booking-request/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json()) as DecisionResponse;
      if (res.ok && data.ok) {
        setStatus(ACTION_RESULT[action].status);
        setNotice({ kind: ACTION_RESULT[action].notice });
      } else if (res.status === 409 && typeof data.occupied === "number") {
        // FR-014 blocked outcome — the server message carries the exact X/Y/Z copy.
        setNotice({ kind: "blocked", message: data.error ?? "Limit dzienny przekroczony" });
      } else if (res.status === 409) {
        setNotice({ kind: "stale", message: data.error ?? "Zapytanie zmieniło status — odśwież stronę" });
      } else {
        setNotice({ kind: "error", message: data.error ?? "Błąd połączenia — spróbuj ponownie" });
      }
    } catch {
      setNotice({ kind: "error", message: "Błąd połączenia — spróbuj ponownie" });
    } finally {
      setSubmitting(null);
      setConfirmingReject(false);
      setConfirmingWithdraw(false);
    }
  }

  const showDecisionButtons = status === "pending" && notice?.kind !== "stale";
  const showWithdrawButton = status === "accepted" && notice?.kind !== "stale";

  return (
    <div className="space-y-4">
      <div>
        <StatusBadge status={status} />
      </div>

      {notice?.kind === "accepted" && (
        <p className="flex items-start gap-2 rounded-lg border border-green-300 bg-green-100 px-3 py-3 text-sm text-green-900">
          <CircleCheck className="mt-0.5 size-4 shrink-0" />
          Zaakceptowano — nauczyciel dostanie e-mail
        </p>
      )}
      {notice?.kind === "rejected" && (
        <p className="flex items-start gap-2 rounded-lg border border-green-300 bg-green-100 px-3 py-3 text-sm text-green-900">
          <CircleCheck className="mt-0.5 size-4 shrink-0" />
          Odrzucono — nauczyciel dostanie e-mail
        </p>
      )}
      {notice?.kind === "withdrawn" && (
        <p className="flex items-start gap-2 rounded-lg border border-green-300 bg-green-100 px-3 py-3 text-sm text-green-900">
          <CircleCheck className="mt-0.5 size-4 shrink-0" />
          Wycofano — nauczyciel dostanie e-mail
        </p>
      )}
      {notice?.kind === "blocked" && (
        <p className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-100 px-3 py-3 text-sm text-red-900">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {notice.message}
        </p>
      )}
      {notice?.kind === "stale" && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-100 px-3 py-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {notice.message}
        </p>
      )}
      {notice?.kind === "error" && (
        <p className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-100 px-3 py-3 text-sm text-red-900">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {notice.message}
        </p>
      )}

      {showDecisionButtons && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => void decide("accept")}
            disabled={submitting !== null}
            className="btn-primary w-full"
          >
            {submitting === "accept" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {submitting === "accept" ? "Akceptowanie…" : "Akceptuj"}
          </button>

          {confirmingReject ? (
            <div className="space-y-2 rounded-lg border border-red-300 bg-red-100 p-3">
              <p className="text-sm text-red-900">Na pewno odrzucić? Tej decyzji nie można cofnąć.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void decide("reject")}
                  disabled={submitting !== null}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {submitting === "reject" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                  {submitting === "reject" ? "Odrzucanie…" : "Tak, odrzuć"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingReject(false);
                  }}
                  disabled={submitting !== null}
                  className="btn-secondary flex-1 disabled:opacity-50"
                >
                  Anuluj
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConfirmingReject(true);
              }}
              disabled={submitting !== null}
              className="btn-secondary w-full disabled:opacity-50"
            >
              <X className="size-4" />
              Odrzuć
            </button>
          )}
        </div>
      )}

      {showWithdrawButton &&
        (confirmingWithdraw ? (
          <div className="space-y-2 rounded-lg border border-red-300 bg-red-100 p-3">
            <p className="text-sm text-red-900">
              Na pewno cofnąć akceptację? Zapytania nie będzie można ponownie zaakceptować.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void decide("withdraw")}
                disabled={submitting !== null}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {submitting === "withdraw" ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
                {submitting === "withdraw" ? "Wycofywanie…" : "Tak, cofnij"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingWithdraw(false);
                }}
                disabled={submitting !== null}
                className="btn-secondary flex-1 disabled:opacity-50"
              >
                Anuluj
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setConfirmingWithdraw(true);
            }}
            disabled={submitting !== null}
            className="btn-secondary w-full disabled:opacity-50"
          >
            <Undo2 className="size-4" />
            Cofnij akceptację
          </button>
        ))}
    </div>
  );
}
