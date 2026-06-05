import React, { useState } from "react";
import { CircleAlert, CircleCheck, Eye, EyeOff, Home, Loader2, MapPin, Save, Users } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";
import { VOIVODESHIPS, zagrodaProfileSchema, fieldErrorsFromZod, type Voivodeship } from "@/lib/zagroda";
import { TurnusyEditor, type TurnusRow } from "@/components/zagroda/TurnusyEditor";
import { PhotoUpload } from "@/components/zagroda/PhotoUpload";

export interface ZagrodaInitialData {
  name: string;
  description: string;
  voivodeship: Voivodeship | null;
  city: string;
  daily_limit: number;
  is_published: boolean;
  turnusy: { id: string; label: string; start_time: string; end_time: string }[];
}

interface Props {
  initialData: ZagrodaInitialData | null;
  photoUrl: string | null;
}

interface SaveResponse {
  ok?: boolean;
  zagroda?: { id: string; is_published: boolean; photo_path: string | null };
  turnusy?: { id: string; label: string; start_time: string; end_time: string }[];
  fieldErrors?: Record<string, string>;
  error?: string;
}

interface PublishResponse {
  is_published?: boolean;
  error?: string;
}

const inputBase =
  "w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:outline-none focus:ring-2";

function fieldClass(error?: string) {
  return cn(inputBase, error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400");
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
      <CircleAlert className="size-3 shrink-0" />
      {message}
    </p>
  );
}

export default function ZagrodaProfileForm({ initialData, photoUrl: initialPhotoUrl }: Props) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [voivodeship, setVoivodeship] = useState<string>(initialData?.voivodeship ?? "");
  const [city, setCity] = useState(initialData?.city ?? "");
  const [dailyLimit, setDailyLimit] = useState(initialData ? String(initialData.daily_limit) : "");
  const [rows, setRows] = useState<TurnusRow[]>(() => (initialData?.turnusy ?? []).map((t) => ({ key: t.id, ...t })));
  const [profileExists, setProfileExists] = useState(initialData !== null);
  const [isPublished, setIsPublished] = useState(initialData?.is_published ?? false);
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  function clearError(field: string) {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: "" }));
  }

  async function save() {
    setServerError(null);
    setPublishError(null);
    setSaved(false);

    const payload = {
      name,
      description,
      voivodeship: voivodeship === "" ? null : voivodeship,
      city,
      daily_limit: dailyLimit.trim() === "" ? Number.NaN : Number(dailyLimit),
      turnusy: rows.map((row) => ({
        id: row.id,
        label: row.label,
        start_time: row.start_time,
        end_time: row.end_time,
      })),
    };
    const parsed = zagrodaProfileSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      const res = await fetch("/api/zagroda", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = (await res.json()) as SaveResponse;
      if (res.status === 422 && data.fieldErrors) {
        setFieldErrors(data.fieldErrors);
      } else if (!res.ok || !data.zagroda || !data.turnusy) {
        setServerError(data.error ?? "Nie udało się zapisać profilu");
      } else {
        // Adopt DB-generated turnus ids so the next save updates instead of re-inserting.
        setRows(data.turnusy.map((t) => ({ key: t.id, ...t })));
        setProfileExists(true);
        setIsPublished(data.zagroda.is_published);
        setSaved(true);
      }
    } catch {
      setServerError("Błąd połączenia — spróbuj ponownie");
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish() {
    setPublishError(null);
    setSaved(false);
    setPublishing(true);
    try {
      const res = await fetch("/api/zagroda/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish: !isPublished }),
      });
      const data = (await res.json()) as PublishResponse;
      if (!res.ok || typeof data.is_published !== "boolean") {
        setPublishError(data.error ?? "Nie udało się zmienić statusu publikacji");
      } else {
        setIsPublished(data.is_published);
      }
    } catch {
      setPublishError("Błąd połączenia — spróbuj ponownie");
    } finally {
      setPublishing(false);
    }
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    void save();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Profil zagrody</h2>
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium",
            isPublished
              ? "border-green-400/30 bg-green-400/15 text-green-300"
              : "border-white/20 bg-white/10 text-blue-100/70",
          )}
        >
          {isPublished ? "Opublikowana" : "Szkic"}
        </span>
      </div>

      <FormField
        id="name"
        label="Nazwa zagrody"
        value={name}
        onChange={(v) => {
          setName(v);
          clearError("name");
        }}
        placeholder="np. Zagroda pod Lipami"
        error={fieldErrors.name || undefined}
        icon={<Home className="size-4" />}
      />

      <div>
        <label htmlFor="description" className="mb-1 block text-sm text-blue-100/80">
          Opis
        </label>
        <textarea
          id="description"
          rows={4}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            clearError("description");
          }}
          placeholder="Opisz, co czeka na grupy w Twojej zagrodzie…"
          className={fieldClass(fieldErrors.description || undefined)}
        />
        <FieldError message={fieldErrors.description || undefined} />
      </div>

      <div>
        <label htmlFor="voivodeship" className="mb-1 block text-sm text-blue-100/80">
          Województwo
        </label>
        <select
          id="voivodeship"
          value={voivodeship}
          onChange={(e) => {
            setVoivodeship(e.target.value);
            clearError("voivodeship");
          }}
          className={cn(fieldClass(fieldErrors.voivodeship || undefined), "appearance-none")}
        >
          <option value="" className="bg-slate-900">
            — wybierz —
          </option>
          {VOIVODESHIPS.map((v) => (
            <option key={v} value={v} className="bg-slate-900">
              {v}
            </option>
          ))}
        </select>
        <FieldError message={fieldErrors.voivodeship || undefined} />
      </div>

      <FormField
        id="city"
        label="Miejscowość"
        value={city}
        onChange={(v) => {
          setCity(v);
          clearError("city");
        }}
        placeholder="np. Lipowa Wola"
        error={fieldErrors.city || undefined}
        icon={<MapPin className="size-4" />}
      />

      <FormField
        id="daily_limit"
        type="number"
        label="Dzienny limit uczestników"
        value={dailyLimit}
        onChange={(v) => {
          setDailyLimit(v);
          clearError("daily_limit");
        }}
        placeholder="np. 40"
        error={fieldErrors.daily_limit || undefined}
        icon={<Users className="size-4" />}
      />

      <TurnusyEditor rows={rows} errors={fieldErrors} onChange={setRows} />
      <FieldError message={fieldErrors.turnusy || undefined} />

      <PhotoUpload disabled={!profileExists} photoUrl={photoUrl} onUploaded={setPhotoUrl} />

      <ServerError message={serverError} />
      {saved && (
        <p className="flex items-center gap-2 rounded-lg border border-green-400/30 bg-green-400/10 px-3 py-2 text-sm text-green-200">
          <CircleCheck className="size-4 shrink-0" />
          Zapisano profil
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-3 font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        {saving ? "Zapisywanie…" : "Zapisz"}
      </button>

      <ServerError message={publishError} />
      <button
        type="button"
        disabled={publishing || !profileExists}
        onClick={() => {
          void togglePublish();
        }}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 font-medium transition-colors disabled:opacity-50",
          isPublished
            ? "border-white/20 bg-white/10 text-blue-100/90 hover:bg-white/20"
            : "border-green-400/40 bg-green-500/20 text-green-200 hover:bg-green-500/30",
        )}
      >
        {publishing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isPublished ? (
          <EyeOff className="size-4" />
        ) : (
          <Eye className="size-4" />
        )}
        {isPublished ? "Cofnij publikację" : "Opublikuj"}
      </button>
      {!profileExists && <p className="text-center text-xs text-blue-100/50">Zapisz profil, aby móc go opublikować.</p>}
    </form>
  );
}
