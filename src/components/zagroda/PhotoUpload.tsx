import { useRef, useState } from "react";
import { Camera, CircleAlert, Loader2 } from "lucide-react";

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

interface PhotoUploadProps {
  /** Photo upload requires an existing zagroda row (photo_path lives on it). */
  disabled: boolean;
  photoUrl: string | null;
  onUploaded: (url: string) => void;
}

interface UploadResponse {
  url?: string;
  error?: string;
}

export function PhotoUpload({ disabled, photoUrl, onUploaded }: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Dozwolone formaty: JPEG, PNG, WebP");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("Zdjęcie może mieć maksymalnie 5 MB");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await fetch("/api/zagroda/photo", { method: "POST", body: form });
      const data = (await res.json()) as UploadResponse;
      if (!res.ok || !data.url) {
        setError(data.error ?? "Nie udało się przesłać zdjęcia");
      } else {
        onUploaded(data.url);
      }
    } catch {
      setError("Błąd połączenia — spróbuj ponownie");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <span className="mb-1 block text-sm text-blue-100/80">Zdjęcie (opcjonalne)</span>
      {photoUrl && (
        <img src={photoUrl} alt="Zdjęcie zagrody" className="mb-2 max-h-48 w-full rounded-lg object-cover" />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled || uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-white transition-colors hover:bg-white/20 disabled:opacity-50"
      >
        {uploading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Przesyłanie…
          </>
        ) : (
          <>
            <Camera className="size-4" />
            {photoUrl ? "Zmień zdjęcie" : "Dodaj zdjęcie"}
          </>
        )}
      </button>
      {disabled && <p className="mt-1 text-xs text-blue-100/50">Zapisz profil, aby dodać zdjęcie.</p>}
      {error && (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
