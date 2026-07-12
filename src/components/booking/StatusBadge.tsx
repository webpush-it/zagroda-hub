import React from "react";

export type RequestStatus = "pending" | "accepted" | "rejected" | "cancelled_by_guest" | "withdrawn_by_owner";

export const STATUS_META: Record<RequestStatus, { label: string; className: string }> = {
  pending: { label: "Oczekujące", className: "border-amber-300 bg-amber-100 text-amber-900" },
  accepted: { label: "Zaakceptowane", className: "border-green-300 bg-green-100 text-green-900" },
  rejected: { label: "Odrzucone", className: "border-red-300 bg-red-100 text-red-900" },
  cancelled_by_guest: { label: "Anulowane", className: "border-edge bg-surface text-ink-muted" },
  withdrawn_by_owner: { label: "Wycofane", className: "border-edge bg-surface text-ink-muted" },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
