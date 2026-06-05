import { z } from "zod";
import { Constants } from "@/db/database.types";

/** Canonical voivodeship values — storage and display values are identical (DB enum). */
export const VOIVODESHIPS = Constants.public.Enums.voivodeship;
export type Voivodeship = (typeof VOIVODESHIPS)[number];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const turnusSchema = z
  .object({
    id: z.uuid().optional(),
    label: z.string().trim().min(1, "Podaj nazwę turnusu").max(120, "Maksymalnie 120 znaków"),
    start_time: z.string().regex(TIME_RE, "Format GG:MM"),
    end_time: z.string().regex(TIME_RE, "Format GG:MM"),
  })
  .refine(
    // Lexicographic compare is correct for valid HH:MM; guard so a format error
    // doesn't stack a misleading order error on top.
    (t) => !TIME_RE.test(t.start_time) || !TIME_RE.test(t.end_time) || t.end_time > t.start_time,
    { message: "Koniec musi być później niż początek", path: ["end_time"] },
  );

/**
 * Draft model: only name and daily_limit are required to save; description,
 * voivodeship and city may stay empty — completeness is enforced at publish
 * time by the DB function set_zagroda_published().
 */
export const zagrodaProfileSchema = z.object({
  name: z.string("Podaj nazwę zagrody").trim().min(1, "Podaj nazwę zagrody").max(120, "Maksymalnie 120 znaków"),
  description: z.string().trim().max(2000, "Maksymalnie 2000 znaków"),
  voivodeship: z.enum(VOIVODESHIPS, "Wybierz województwo z listy").nullable(),
  city: z.string().trim().max(120, "Maksymalnie 120 znaków"),
  daily_limit: z
    .number("Podaj dzienny limit uczestników")
    .int("Limit musi być liczbą całkowitą")
    .min(1, "Limit musi wynosić co najmniej 1")
    .max(1000, "Limit nie może przekraczać 1000"),
  turnusy: z.array(turnusSchema).max(20, "Maksymalnie 20 turnusów"),
});

export type ZagrodaProfileInput = z.infer<typeof zagrodaProfileSchema>;

/** Flattens zod issues to `path.joined.keys` → first message (e.g. "turnusy.0.label"). */
export function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
