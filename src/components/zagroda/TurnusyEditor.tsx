import { CircleAlert, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TurnusRow {
  /** Stable client-side key; equals the DB id for persisted rows. */
  key: string;
  id?: string;
  label: string;
  start_time: string;
  end_time: string;
}

interface TurnusyEditorProps {
  rows: TurnusRow[];
  /** Field errors keyed `turnusy.<index>.<field>` (see fieldErrorsFromZod). */
  errors: Record<string, string>;
  onChange: (rows: TurnusRow[]) => void;
}

const inputBase =
  "w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:outline-none focus:ring-2";

function fieldClass(error?: string) {
  return cn(inputBase, error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400");
}

export function TurnusyEditor({ rows, errors, onChange }: TurnusyEditorProps) {
  function update(key: string, patch: Partial<TurnusRow>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <fieldset>
      <legend className="mb-1 block text-sm text-blue-100/80">Turnusy (dzienne przedziały godzin)</legend>
      {rows.length === 0 && (
        <p className="mb-2 text-xs text-blue-100/50">Dodaj co najmniej jeden turnus, aby móc opublikować zagrodę.</p>
      )}
      <div className="space-y-3">
        {rows.map((row, i) => {
          const labelError = errors[`turnusy.${i}.label`];
          const startError = errors[`turnusy.${i}.start_time`];
          const endError = errors[`turnusy.${i}.end_time`];
          return (
            <div key={row.key} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <input
                    aria-label={`Nazwa turnusu ${i + 1}`}
                    value={row.label}
                    onChange={(e) => {
                      update(row.key, { label: e.target.value });
                    }}
                    placeholder="np. Turnus poranny"
                    className={fieldClass(labelError)}
                  />
                  {labelError && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
                      <CircleAlert className="size-3 shrink-0" />
                      {labelError}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Usuń turnus ${i + 1}`}
                  onClick={() => {
                    onChange(rows.filter((r) => r.key !== row.key));
                  }}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-white/20 text-red-300 transition-colors hover:bg-red-400/10"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor={`turnus-${row.key}-start`} className="mb-1 block text-xs text-blue-100/60">
                    Od
                  </label>
                  <input
                    id={`turnus-${row.key}-start`}
                    type="time"
                    value={row.start_time}
                    onChange={(e) => {
                      update(row.key, { start_time: e.target.value });
                    }}
                    className={fieldClass(startError)}
                  />
                  {startError && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
                      <CircleAlert className="size-3 shrink-0" />
                      {startError}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor={`turnus-${row.key}-end`} className="mb-1 block text-xs text-blue-100/60">
                    Do
                  </label>
                  <input
                    id={`turnus-${row.key}-end`}
                    type="time"
                    value={row.end_time}
                    onChange={(e) => {
                      update(row.key, { end_time: e.target.value });
                    }}
                    className={fieldClass(endError)}
                  />
                  {endError && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
                      <CircleAlert className="size-3 shrink-0" />
                      {endError}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => {
          onChange([...rows, { key: crypto.randomUUID(), label: "", start_time: "", end_time: "" }]);
        }}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/30 px-4 py-3 text-sm text-blue-100/80 transition-colors hover:bg-white/10"
      >
        <Plus className="size-4" />
        Dodaj turnus
      </button>
    </fieldset>
  );
}
