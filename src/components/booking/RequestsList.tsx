import React, { useState } from "react";
import { Calendar, ChevronRight, Clock, Inbox, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge, type RequestStatus } from "@/components/booking/StatusBadge";

export interface RequestRow {
  id: string;
  trip_date: string;
  turnus_label: string;
  participants_count: number;
  guest_name: string;
  status: RequestStatus;
  created_at: string;
}

type FilterKey = "pending" | "accepted" | "rejected" | "cancelled";

const FILTERS: { key: FilterKey; label: string; matches: (s: RequestStatus) => boolean }[] = [
  { key: "pending", label: "Oczekujące", matches: (s) => s === "pending" },
  { key: "accepted", label: "Zaakceptowane", matches: (s) => s === "accepted" },
  { key: "rejected", label: "Odrzucone", matches: (s) => s === "rejected" },
  { key: "cancelled", label: "Anulowane", matches: (s) => s === "cancelled_by_guest" || s === "withdrawn_by_owner" },
];

export default function RequestsList({ rows }: { rows: RequestRow[] }) {
  const [filterKey, setFilterKey] = useState<FilterKey>("pending");
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];
  const visible = rows.filter((r) => filter.matches(r.status));

  return (
    <div className="space-y-4">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filtr statusu">
        {FILTERS.map((f) => {
          const count = rows.filter((r) => f.matches(r.status)).length;
          const active = f.key === filterKey;
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setFilterKey(f.key);
              }}
              className={cn(
                "tap-target shrink-0 rounded-full border px-3 py-2 text-sm transition-colors",
                active
                  ? "border-brand-600 bg-brand-600 font-medium text-white"
                  : "border-edge text-ink-muted hover:bg-brand-50 bg-white",
              )}
            >
              {f.label} <span className={active ? "text-brand-100" : "text-ink-muted"}>({count})</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="border-edge bg-surface flex flex-col items-center gap-2 rounded-xl border px-4 py-8 text-center">
          <Inbox className="text-ink-muted size-6" aria-hidden="true" />
          <p className="text-ink-muted text-sm">Brak zapytań w tej kategorii.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((r) => (
            <li key={r.id}>
              <a
                href={`/dashboard/zapytania/${r.id}`}
                className="border-edge bg-surface hover:bg-brand-50 flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <span className="text-ink-muted shrink-0 text-xs whitespace-nowrap">
                      Wysłano {r.created_at.slice(0, 10)}
                    </span>
                  </div>
                  <p className="text-ink flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="flex items-center gap-1">
                      <Calendar className="text-ink-muted size-3.5 shrink-0" aria-hidden="true" />
                      {r.trip_date}
                    </span>
                    <span className="flex min-w-0 items-center gap-1 break-words">
                      <Clock className="text-ink-muted size-3.5 shrink-0" aria-hidden="true" />
                      {r.turnus_label}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="text-ink-muted size-3.5 shrink-0" aria-hidden="true" />
                      {r.participants_count}
                    </span>
                  </p>
                  <p className="text-ink-muted flex items-center gap-1 truncate text-sm">
                    <User className="text-ink-muted size-3.5 shrink-0" aria-hidden="true" />
                    {r.guest_name}
                  </p>
                </div>
                <ChevronRight className="text-ink-muted size-5 shrink-0" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
