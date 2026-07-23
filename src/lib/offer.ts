import { z } from "zod";
import { Constants } from "@/db/database.types";

// S-12 (FR-024, FR-025, FR-031): single source of truth for offer validation
// and presentation, shared by the owner form (client) and the /api/offer routes
// (server) — same client+server contract as bookingRequestSchema in
// src/lib/booking.ts. Storage tokens come from the generated DB enums; human
// labels live here (presentation layer), mirroring GROUP_TYPE_VALUES/LABELS.

export { fieldErrorsFromZod } from "@/lib/zagroda";

/** Price unit — chosen per offer; only meaningful together with an amount. */
export const PRICE_UNIT_VALUES = Constants.public.Enums.price_unit;
export type PriceUnit = (typeof PRICE_UNIT_VALUES)[number];
export const PRICE_UNIT_LABELS: Record<PriceUnit, string> = {
  za_osobe: "za osobę",
  za_grupe: "za grupę",
};

/** Tematyka zajęć — the OSZE catalog (11 values), adopted 1:1 from the DB enum. */
export const OFERTA_TEMAT_VALUES = Constants.public.Enums.oferta_temat;
export type OfertaTemat = (typeof OFERTA_TEMAT_VALUES)[number];
export const OFERTA_TEMAT_LABELS: Record<OfertaTemat, string> = {
  edukacja_regionalna: "Edukacja regionalna",
  ekologia: "Ekologia",
  ginace_zawody: "Ginące zawody",
  kuchnia_domowa: "Kuchnia domowa",
  przyroda: "Przyroda",
  rekodzielo_artystyczne: "Rękodzieło artystyczne",
  rolnictwo: "Rolnictwo",
  tradycyjna_zywnosc: "Tradycyjna żywność",
  zajecia_rekreacyjne: "Zajęcia rekreacyjne",
  zajecia_sportowe: "Zajęcia sportowe",
  zwyczaje_obrzedy: "Zwyczaje i obrzędy",
};

/** Adresaci — who the offer is FOR (owner declares); 6-value candidate taxonomy. */
export const OFERTA_ADRESAT_VALUES = Constants.public.Enums.oferta_adresat;
export type OfertaAdresat = (typeof OFERTA_ADRESAT_VALUES)[number];
export const OFERTA_ADRESAT_LABELS: Record<OfertaAdresat, string> = {
  przedszkola: "Przedszkola",
  szkoly_podstawowe: "Szkoły podstawowe",
  szkoly_ponadpodstawowe: "Szkoły ponadpodstawowe",
  rodziny: "Rodziny",
  dorosli: "Dorośli",
  seniorzy: "Seniorzy",
};

// The editable offer fields. Split out from the refine so the update variant can
// extend it (a refined schema is a ZodEffects and can no longer be extended).
const offerFields = z.object({
  nazwa: z.string("Podaj nazwę oferty").trim().min(1, "Podaj nazwę oferty").max(120, "Maksymalnie 120 znaków"),
  opis: z.string().trim().max(2000, "Maksymalnie 2000 znaków").optional(),
  czas_trwania: z.string().trim().max(120, "Maksymalnie 120 znaków").optional(),
  temat: z.array(z.enum(OFERTA_TEMAT_VALUES)).min(1, "Wybierz co najmniej jeden temat"),
  adresaci: z.array(z.enum(OFERTA_ADRESAT_VALUES)).min(1, "Wybierz co najmniej jednego adresata"),
  // Price is integer grosze (nullable via optional — no amount means „cena
  // ustalana indywidualnie"); the unit is only meaningful with an amount.
  amount_grosze: z
    .number("Podaj kwotę")
    .int("Kwota musi być liczbą całkowitą groszy")
    .positive("Kwota musi być dodatnia")
    .optional(),
  price_unit: z.enum(PRICE_UNIT_VALUES, "Wybierz jednostkę ceny").optional(),
});

/**
 * Mirror of the DB CHECK oferty_amount_needs_unit, extended to also reject a
 * unit without an amount: kwota and jednostka are present together or not at
 * all. Error is attached to price_unit (the field the form pairs with amount).
 */
const amountUnitPaired = (v: { amount_grosze?: number; price_unit?: PriceUnit }): boolean =>
  (v.amount_grosze == null) === (v.price_unit == null);
const amountUnitError = { message: "Podaj kwotę i jednostkę razem albo pozostaw oba puste", path: ["price_unit"] };

export const offerSchema = offerFields.refine(amountUnitPaired, amountUnitError);
export type OfferInput = z.infer<typeof offerSchema>;

/** PATCH payload: the editable fields plus the id and an optional sort_order. */
export const offerUpdateSchema = offerFields
  .extend({
    id: z.uuid("Nieprawidłowy identyfikator oferty"),
    sort_order: z.number().int().min(0).optional(),
  })
  .refine(amountUnitPaired, amountUnitError);
export type OfferUpdateInput = z.infer<typeof offerUpdateSchema>;

/** DELETE (soft-delete) payload. */
export const offerIdSchema = z.object({ id: z.uuid("Nieprawidłowy identyfikator oferty") });

/** Reorder payload: an ordered id list; sort_order is assigned by array index. */
export const reorderSchema = z.object({ ids: z.array(z.uuid("Nieprawidłowy identyfikator oferty")).min(1) });

/** Grosze → złoty as a plain number (25_00 → 25). For display/input round-trip. */
export function groszeToZloty(grosze: number): number {
  return grosze / 100;
}

/** Złoty → integer grosze, rounded (25.5 → 2550). */
export function zlotyToGrosze(zloty: number): number {
  return Math.round(zloty * 100);
}

/**
 * Presentation of a price: „25,00 zł / os." | „… / grupa" when priced, or
 * „cena ustalana indywidualnie" when no amount is set. Comma decimal (PL).
 */
export function formatOfferPrice(amount_grosze: number | null, unit: PriceUnit | null): string {
  if (amount_grosze == null || unit == null) {
    return "cena ustalana indywidualnie";
  }
  const zloty = (amount_grosze / 100).toFixed(2).replace(".", ",");
  const unitLabel = unit === "za_osobe" ? "os." : "grupa";
  return `${zloty} zł / ${unitLabel}`;
}
