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
                "shrink-0 rounded-full border px-3 py-2 text-sm transition-colors",
                active
                  ? "border-purple-400/60 bg-purple-600/40 font-medium text-white"
                  : "border-white/15 bg-white/5 text-blue-100/70 hover:bg-white/10",
              )}
            >
              {f.label} <span className={active ? "text-purple-200" : "text-blue-100/50"}>({count})</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-8 text-center">
          <Inbox className="size-6 text-blue-100/40" aria-hidden="true" />
          <p className="text-sm text-blue-100/60">Brak zapytań w tej kategorii.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((r) => (
            <li key={r.id}>
              <a
                href={`/dashboard/zapytania/${r.id}`}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/10"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <span className="text-xs text-blue-100/50">Wysłano {r.created_at.slice(0, 10)}</span>
                  </div>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white">
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3.5 shrink-0 text-blue-100/50" aria-hidden="true" />
                      {r.trip_date}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5 shrink-0 text-blue-100/50" aria-hidden="true" />
                      {r.turnus_label}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="size-3.5 shrink-0 text-blue-100/50" aria-hidden="true" />
                      {r.participants_count}
                    </span>
                  </p>
                  <p className="flex items-center gap-1 truncate text-sm text-blue-100/70">
                    <User className="size-3.5 shrink-0 text-blue-100/50" aria-hidden="true" />
                    {r.guest_name}
                  </p>
                </div>
                <ChevronRight className="size-5 shrink-0 text-blue-100/40" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
