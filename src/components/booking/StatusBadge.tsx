import React from "react";

export type RequestStatus = "pending" | "accepted" | "rejected" | "cancelled_by_guest" | "withdrawn_by_owner";

// withdrawn_by_owner shares the "Anulowane" bucket until S-05 gives it its own flow.
export const STATUS_META: Record<RequestStatus, { label: string; className: string }> = {
  pending: { label: "Oczekujące", className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
  accepted: { label: "Zaakceptowane", className: "border-green-400/30 bg-green-400/10 text-green-200" },
  rejected: { label: "Odrzucone", className: "border-red-400/30 bg-red-400/10 text-red-300" },
  cancelled_by_guest: { label: "Anulowane", className: "border-white/20 bg-white/5 text-blue-100/70" },
  withdrawn_by_owner: { label: "Anulowane", className: "border-white/20 bg-white/5 text-blue-100/70" },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
