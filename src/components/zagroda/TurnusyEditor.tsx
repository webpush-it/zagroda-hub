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

function fieldClass(error?: string) {
  return cn("input-field", error && "border-red-500 focus:border-red-500");
}

export function TurnusyEditor({ rows, errors, onChange }: TurnusyEditorProps) {
  function update(key: string, patch: Partial<TurnusRow>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <fieldset>
      <legend className="text-ink-muted mb-1 block text-sm">Turnusy (dzienne przedziały godzin)</legend>
      {rows.length === 0 && (
        <p className="text-ink-muted mb-2 text-xs">Dodaj co najmniej jeden turnus, aby móc opublikować zagrodę.</p>
      )}
      <div className="space-y-3">
        {rows.map((row, i) => {
          const labelError = errors[`turnusy.${i}.label`];
          const startError = errors[`turnusy.${i}.start_time`];
          const endError = errors[`turnusy.${i}.end_time`];
          return (
            <div key={row.key} className="border-edge bg-surface rounded-lg border p-3">
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
                    <p className="mt-1 flex items-center gap-1 text-xs text-red-700">
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
                  className="border-edge-strong flex size-11 shrink-0 items-center justify-center rounded-lg border bg-white text-red-700 transition-colors hover:bg-red-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor={`turnus-${row.key}-start`} className="text-ink-muted mb-1 block text-xs">
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
                  <label htmlFor={`turnus-${row.key}-end`} className="text-ink-muted mb-1 block text-xs">
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
        className="border-edge-strong text-ink-muted hover:bg-brand-50 mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm transition-colors"
      >
        <Plus className="size-4" />
        Dodaj turnus
      </button>
    </fieldset>
  );
}
