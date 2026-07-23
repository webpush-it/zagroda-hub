import React, { useState } from "react";
import { ArrowDown, ArrowUp, CircleAlert, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";
import {
  OFERTA_ADRESAT_LABELS,
  OFERTA_ADRESAT_VALUES,
  OFERTA_TEMAT_LABELS,
  OFERTA_TEMAT_VALUES,
  PRICE_UNIT_LABELS,
  PRICE_UNIT_VALUES,
  formatOfferPrice,
  fieldErrorsFromZod,
  groszeToZloty,
  offerSchema,
  offerUpdateSchema,
  zlotyToGrosze,
  type OfertaAdresat,
  type OfertaTemat,
  type PriceUnit,
} from "@/lib/offer";

// S-12 (FR-024/FR-025/FR-031): owner-facing CRUD + reorder for a zagroda's
// offers. Follows the form-island conventions (ManualBookingForm/DayBlocks):
// expand-in-place, client-side validation via the shared offerSchema, and a
// full page reload on success (the SSR list is the server truth — no client
// cache). Reorder is index-based and POSTs to /api/offer/reorder.

export interface OfferRow {
  id: string;
  nazwa: string;
  opis: string | null;
  czas_trwania: string | null;
  temat: OfertaTemat[];
  adresaci: OfertaAdresat[];
  amount_grosze: number | null;
  price_unit: PriceUnit | null;
  is_active: boolean;
}

interface Props {
  offers: OfferRow[];
}

interface SubmitResponse {
  ok?: boolean;
  fieldErrors?: Record<string, string>;
  error?: string;
}

/** The editable shape of an offer form (price as a złoty string for input). */
interface OfferDraft {
  nazwa: string;
  opis: string;
  czas_trwania: string;
  temat: OfertaTemat[];
  adresaci: OfertaAdresat[];
  amount_zloty: string;
  price_unit: "" | PriceUnit;
}

const emptyDraft: OfferDraft = {
  nazwa: "",
  opis: "",
  czas_trwania: "",
  temat: [],
  adresaci: [],
  amount_zloty: "",
  price_unit: "",
};

function draftFromRow(o: OfferRow): OfferDraft {
  return {
    nazwa: o.nazwa,
    opis: o.opis ?? "",
    czas_trwania: o.czas_trwania ?? "",
    temat: o.temat,
    adresaci: o.adresaci,
    amount_zloty: o.amount_grosze == null ? "" : String(groszeToZloty(o.amount_grosze)),
    price_unit: o.price_unit ?? "",
  };
}

/** Draft → the API field payload (shared by create + edit). */
function draftToFields(draft: OfferDraft) {
  const amountRaw = draft.amount_zloty.trim();
  return {
    nazwa: draft.nazwa,
    opis: draft.opis.trim() === "" ? undefined : draft.opis,
    czas_trwania: draft.czas_trwania.trim() === "" ? undefined : draft.czas_trwania,
    temat: draft.temat,
    adresaci: draft.adresaci,
    amount_grosze: amountRaw === "" ? undefined : zlotyToGrosze(Number(amountRaw.replace(",", "."))),
    price_unit: draft.price_unit === "" ? undefined : draft.price_unit,
  };
}

function fieldClass(error?: string) {
  return cn("input-field", error && "border-red-500 focus:border-red-500");
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-red-700">
      <CircleAlert className="size-3 shrink-0" />
      {message}
    </p>
  );
}

/** Multi-select chip group over an enum's values. */
function ChipGroup<T extends string>({
  legend,
  values,
  labels,
  selected,
  onToggle,
  error,
}: {
  legend: string;
  values: readonly T[];
  labels: Record<T, string>;
  selected: T[];
  onToggle: (value: T) => void;
  error?: string;
}) {
  return (
    <fieldset>
      <legend className="text-ink-muted mb-1 block text-sm">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                onToggle(value);
              }}
              className={cn(
                "tap-target rounded-full border px-3 text-sm transition-colors",
                active
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-edge-strong text-ink hover:bg-brand-50 bg-white",
              )}
            >
              {labels[value]}
            </button>
          );
        })}
      </div>
      <FieldError message={error} />
    </fieldset>
  );
}

function OfferForm({
  title,
  draft,
  errors,
  serverError,
  submitting,
  onChange,
  onSubmit,
  onCancel,
}: {
  title: string;
  draft: OfferDraft;
  errors: Record<string, string>;
  serverError: string | null;
  submitting: boolean;
  onChange: (patch: Partial<OfferDraft>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="border-edge bg-surface space-y-4 rounded-xl border p-4" noValidate>
      <div className="flex items-center justify-between">
        <h2 className="text-ink text-base font-semibold">{title}</h2>
        <button
          type="button"
          aria-label="Zamknij formularz"
          onClick={onCancel}
          className="border-edge-strong text-ink-muted flex size-11 shrink-0 items-center justify-center rounded-lg border bg-white transition-colors hover:bg-red-100"
        >
          <X className="size-4" />
        </button>
      </div>

      <div>
        <label htmlFor="offer_nazwa" className="text-ink-muted mb-1 block text-sm">
          Nazwa oferty
        </label>
        <input
          id="offer_nazwa"
          value={draft.nazwa}
          onChange={(e) => {
            onChange({ nazwa: e.target.value });
          }}
          placeholder="np. Warsztaty pieczenia chleba"
          className={fieldClass(errors.nazwa)}
        />
        <FieldError message={errors.nazwa} />
      </div>

      <div>
        <label htmlFor="offer_opis" className="text-ink-muted mb-1 block text-sm">
          Opis (opcjonalnie)
        </label>
        <textarea
          id="offer_opis"
          rows={3}
          value={draft.opis}
          onChange={(e) => {
            onChange({ opis: e.target.value });
          }}
          maxLength={2000}
          placeholder="Co czeka na uczestników?"
          className={fieldClass(errors.opis)}
        />
        <FieldError message={errors.opis} />
      </div>

      <div>
        <label htmlFor="offer_czas" className="text-ink-muted mb-1 block text-sm">
          Czas trwania (opcjonalnie)
        </label>
        <input
          id="offer_czas"
          value={draft.czas_trwania}
          onChange={(e) => {
            onChange({ czas_trwania: e.target.value });
          }}
          maxLength={120}
          placeholder="np. 2 godziny"
          className={fieldClass(errors.czas_trwania)}
        />
        <FieldError message={errors.czas_trwania} />
      </div>

      <ChipGroup
        legend="Temat zajęć"
        values={OFERTA_TEMAT_VALUES}
        labels={OFERTA_TEMAT_LABELS}
        selected={draft.temat}
        onToggle={(value) => {
          onChange({
            temat: draft.temat.includes(value) ? draft.temat.filter((t) => t !== value) : [...draft.temat, value],
          });
        }}
        error={errors.temat}
      />

      <ChipGroup
        legend="Adresaci"
        values={OFERTA_ADRESAT_VALUES}
        labels={OFERTA_ADRESAT_LABELS}
        selected={draft.adresaci}
        onToggle={(value) => {
          onChange({
            adresaci: draft.adresaci.includes(value)
              ? draft.adresaci.filter((a) => a !== value)
              : [...draft.adresaci, value],
          });
        }}
        error={errors.adresaci}
      />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor="offer_amount" className="text-ink-muted mb-1 block text-sm">
            Cena w zł (opcjonalnie)
          </label>
          <input
            id="offer_amount"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={draft.amount_zloty}
            onChange={(e) => {
              onChange({ amount_zloty: e.target.value });
            }}
            placeholder="np. 25"
            className={fieldClass(errors.amount_grosze)}
          />
          <FieldError message={errors.amount_grosze} />
        </div>
        <div>
          <label htmlFor="offer_unit" className="text-ink-muted mb-1 block text-sm">
            Jednostka
          </label>
          <select
            id="offer_unit"
            value={draft.price_unit}
            onChange={(e) => {
              onChange({ price_unit: e.target.value as "" | PriceUnit });
            }}
            className={cn(fieldClass(errors.price_unit), "appearance-none")}
          >
            <option value="">— wybierz —</option>
            {PRICE_UNIT_VALUES.map((value) => (
              <option key={value} value={value}>
                {PRICE_UNIT_LABELS[value]}
              </option>
            ))}
          </select>
          <FieldError message={errors.price_unit} />
        </div>
      </div>
      <p className="text-ink-muted text-xs">Bez podanej ceny oferta pokaże „cena ustalana indywidualnie&rdquo;.</p>

      <ServerError message={serverError} />

      <button type="submit" disabled={submitting} className="btn-primary w-full">
        {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {submitting ? "Zapisywanie…" : "Zapisz ofertę"}
      </button>
    </form>
  );
}

type OpenForm = { mode: "add" } | { mode: "edit"; id: string } | null;

export default function OffersManager({ offers }: Props) {
  const active = offers.filter((o) => o.is_active);
  const inactive = offers.filter((o) => !o.is_active);

  const [openForm, setOpenForm] = useState<OpenForm>(null);
  const [draft, setDraft] = useState<OfferDraft>(emptyDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function openAdd() {
    setDraft(emptyDraft);
    setErrors({});
    setServerError(null);
    setOpenForm({ mode: "add" });
  }

  function openEdit(o: OfferRow) {
    setDraft(draftFromRow(o));
    setErrors({});
    setServerError(null);
    setOpenForm({ mode: "edit", id: o.id });
  }

  function closeForm() {
    setOpenForm(null);
    setErrors({});
    setServerError(null);
  }

  async function submitForm() {
    if (!openForm) return;
    setServerError(null);

    const fields = draftToFields(draft);
    const isEdit = openForm.mode === "edit";
    const payload = isEdit ? { id: openForm.id, ...fields } : fields;
    const schema = isEdit ? offerUpdateSchema : offerSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const res = await fetch("/api/offer", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = (await res.json()) as SubmitResponse;
      if (res.status === 422 && data.fieldErrors) {
        setErrors(data.fieldErrors);
        setSubmitting(false);
      } else if (!res.ok || !data.ok) {
        setServerError(data.error ?? "Nie udało się zapisać oferty — spróbuj ponownie");
        setSubmitting(false);
      } else {
        window.location.reload();
      }
    } catch {
      setServerError("Błąd połączenia — spróbuj ponownie");
      setSubmitting(false);
    }
  }

  async function softDelete(id: string) {
    setRowError(null);
    setBusyId(id);
    try {
      const res = await fetch("/api/offer", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json()) as SubmitResponse;
      if (res.ok && data.ok) {
        window.location.reload();
        return;
      }
      // 404 soft outcome (already removed elsewhere) — a reload shows the truth.
      setRowError(data.error ?? "Nie udało się usunąć oferty — spróbuj ponownie");
    } catch {
      setRowError("Błąd połączenia — spróbuj ponownie");
    }
    setBusyId(null);
    setConfirmingDelete(null);
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= active.length) return;
    const reordered = [...active];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    // Persist a globally consistent order: reordered active first, then the
    // untouched inactive rows. sort_order = array index (see reorder route).
    const ids = [...reordered.map((o) => o.id), ...inactive.map((o) => o.id)];

    setRowError(null);
    setBusyId(active[index].id);
    try {
      const res = await fetch("/api/offer/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json()) as SubmitResponse;
      if (res.ok && data.ok) {
        window.location.reload();
        return;
      }
      setRowError(data.error ?? "Nie udało się zmienić kolejności — spróbuj ponownie");
    } catch {
      setRowError("Błąd połączenia — spróbuj ponownie");
    }
    setBusyId(null);
  }

  function patchDraft(patch: Partial<OfferDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  return (
    <div className="space-y-4">
      {active.length === 0 && inactive.length === 0 && openForm?.mode !== "add" && (
        <p className="text-ink-muted text-sm">
          Nie masz jeszcze żadnych ofert. Dodaj pierwszą, aby pokazać ją gościom.
        </p>
      )}

      <ServerError message={rowError} />

      {active.length > 0 && (
        <ul className="space-y-3">
          {active.map((o, i) => (
            <li key={o.id}>
              {openForm?.mode === "edit" && openForm.id === o.id ? (
                <OfferForm
                  title="Edytuj ofertę"
                  draft={draft}
                  errors={errors}
                  serverError={serverError}
                  submitting={submitting}
                  onChange={patchDraft}
                  onSubmit={() => void submitForm()}
                  onCancel={closeForm}
                />
              ) : confirmingDelete === o.id ? (
                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-100 p-3">
                  <p className="text-sm text-amber-900">
                    Usunąć „{o.nazwa}&rdquo;? Oferta zniknie ze strony zagrody. Pozostanie ukryta na Twojej liście.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void softDelete(o.id)}
                      disabled={busyId !== null}
                      className="btn-primary flex-1"
                    >
                      {busyId === o.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      {busyId === o.id ? "Usuwanie…" : "Tak, usuń"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingDelete(null);
                      }}
                      disabled={busyId !== null}
                      className="btn-secondary flex-1 disabled:opacity-50"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <div className="border-edge bg-surface rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-ink font-medium">{o.nazwa}</p>
                      {o.czas_trwania && <p className="text-ink-muted text-sm">{o.czas_trwania}</p>}
                      <p className="text-ink-muted text-sm">{formatOfferPrice(o.amount_grosze, o.price_unit)}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {o.temat.map((t) => (
                          <span
                            key={t}
                            className="border-edge text-ink-muted rounded-full border bg-white px-2 py-0.5 text-xs"
                          >
                            {OFERTA_TEMAT_LABELS[t]}
                          </span>
                        ))}
                        {o.adresaci.map((a) => (
                          <span
                            key={a}
                            className="border-brand-200 bg-brand-50 text-brand-700 rounded-full border px-2 py-0.5 text-xs"
                          >
                            {OFERTA_ADRESAT_LABELS[a]}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        aria-label={`Przenieś „${o.nazwa}" w górę`}
                        onClick={() => void move(i, -1)}
                        disabled={i === 0 || busyId !== null}
                        className="border-edge-strong text-ink-muted hover:bg-brand-50 flex size-11 items-center justify-center rounded-lg border bg-white transition-colors disabled:opacity-40"
                      >
                        <ArrowUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Przenieś „${o.nazwa}" w dół`}
                        onClick={() => void move(i, 1)}
                        disabled={i === active.length - 1 || busyId !== null}
                        className="border-edge-strong text-ink-muted hover:bg-brand-50 flex size-11 items-center justify-center rounded-lg border bg-white transition-colors disabled:opacity-40"
                      >
                        <ArrowDown className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        openEdit(o);
                      }}
                      className="border-edge-strong text-ink tap-target hover:bg-brand-50 flex flex-1 items-center justify-center gap-1 rounded-lg border bg-white text-sm transition-colors"
                    >
                      <Pencil className="size-4" />
                      Edytuj
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRowError(null);
                        setConfirmingDelete(o.id);
                      }}
                      className="border-edge-strong tap-target flex flex-1 items-center justify-center gap-1 rounded-lg border bg-white text-sm text-red-700 transition-colors hover:bg-red-100"
                    >
                      <Trash2 className="size-4" />
                      Usuń
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {openForm?.mode === "add" ? (
        <OfferForm
          title="Nowa oferta"
          draft={draft}
          errors={errors}
          serverError={serverError}
          submitting={submitting}
          onChange={patchDraft}
          onSubmit={() => void submitForm()}
          onCancel={closeForm}
        />
      ) : (
        <button
          type="button"
          onClick={openAdd}
          className="border-edge-strong text-ink-muted hover:bg-brand-50 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm transition-colors"
        >
          <Plus className="size-4" />
          Dodaj ofertę
        </button>
      )}

      {inactive.length > 0 && (
        <section aria-label="Ukryte oferty" className="space-y-2">
          <h2 className="text-ink-muted text-sm font-medium">Ukryte oferty (niewidoczne dla gości)</h2>
          <ul className="space-y-2">
            {inactive.map((o) => (
              <li
                key={o.id}
                className="border-edge bg-surface text-ink-muted flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate line-through">{o.nazwa}</span>
                <span className="text-ink-muted shrink-0 text-xs">
                  {formatOfferPrice(o.amount_grosze, o.price_unit)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
