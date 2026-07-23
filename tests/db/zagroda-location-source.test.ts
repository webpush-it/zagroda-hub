import { randomUUID } from "node:crypto";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { backfillZagrody } from "../../scripts/seed-localities";
import { createAdminClient, createOwnerClient, seedZagroda, uniqueEmail, type TypedClient } from "../helpers/supabase";

// zagroda-map-location Phase 1: manual/auto coordinate precedence. The
// location_source discriminator lets an owner-dropped pin ('manual') survive
// city/voivodeship edits and re-seeds, while 'auto' rows keep deriving coords
// from the locality name exactly as in S-10. Names carry a per-run suffix so
// this suite is isolated in the shared DB and re-runnable.

const PASSWORD = "test-password-123";
const RUN = randomUUID().slice(0, 8);

// A precise locality in mazowieckie + its centroid (from the migration).
const PRECISE_NAME = `Pinowo${RUN}`;
const PRECISE = { lat: 52.7, lng: 19.3 };
const MAZ_CENTROID = { lat: 52.3, lng: 21.0 };

// A hand-dropped pin, deliberately distinct from every derived value above.
const MANUAL = { lat: 49.55, lng: 22.45 };

let admin: TypedClient;
let pg: PgClient;

/** Inserts a locality; name_normalized is computed by the DB (single source of truth, F2). */
async function seedLocality(v: string, name: string, lat: number, lng: number): Promise<void> {
  await pg.query(
    `insert into public.localities (voivodeship, name, name_normalized, latitude, longitude)
     values ($1::public.voivodeship, $2, public.locality_normalize($2), $3, $4)
     on conflict (voivodeship, name_normalized) do nothing`,
    [v, name, lat, lng],
  );
}

/** Seeds a zagroda under a fresh owner (owner_id is UNIQUE — one each). */
async function seedOwned(opts: Omit<Parameters<typeof seedZagroda>[1], "ownerId">) {
  const { userId } = await createOwnerClient(uniqueEmail("locsrc-owner"), PASSWORD);
  return seedZagroda(admin, { ownerId: userId, ...opts });
}

async function readCoords(zagrodaId: string) {
  const { data, error } = await admin
    .from("zagrody")
    .select("latitude, longitude, location_precise, location_source")
    .eq("id", zagrodaId)
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error(`readCoords: no zagroda row for ${zagrodaId}`);
  return data;
}

/** Sets a manual pin via the service-role client (the trigger forces location_precise=true). */
async function setManualPin(zagrodaId: string, lat: number, lng: number): Promise<void> {
  const { error } = await admin
    .from("zagrody")
    .update({ location_source: "manual", latitude: lat, longitude: lng })
    .eq("id", zagrodaId);
  expect(error).toBeNull();
}

beforeAll(async () => {
  admin = createAdminClient();
  pg = new PgClient({ connectionString: inject("supabaseDbUrl") });
  await pg.connect();
  await seedLocality("mazowieckie", PRECISE_NAME, PRECISE.lat, PRECISE.lng);
});

afterAll(async () => {
  await pg.end();
});

describe("zagrody_set_coords — manual precedence", () => {
  it("(a) a manual pin survives a city update (name derivation does not clobber it)", async () => {
    const { zagrodaId } = await seedOwned({ dailyLimit: 10, voivodeship: "mazowieckie", city: PRECISE_NAME });

    await setManualPin(zagrodaId, MANUAL.lat, MANUAL.lng);
    expect(await readCoords(zagrodaId)).toMatchObject({
      latitude: MANUAL.lat,
      longitude: MANUAL.lng,
      location_precise: true,
      location_source: "manual",
    });

    // Changing the city must NOT move the pin — the trigger's manual branch skips derivation.
    await admin
      .from("zagrody")
      .update({ city: `Zupełnie Inne${RUN}` })
      .eq("id", zagrodaId);
    expect(await readCoords(zagrodaId)).toMatchObject({
      latitude: MANUAL.lat,
      longitude: MANUAL.lng,
      location_precise: true,
      location_source: "manual",
    });
  });

  it("(b) reverting manual -> auto re-derives coords from the name", async () => {
    const { zagrodaId } = await seedOwned({ dailyLimit: 10, voivodeship: "mazowieckie", city: PRECISE_NAME });
    await setManualPin(zagrodaId, MANUAL.lat, MANUAL.lng);
    expect(await readCoords(zagrodaId)).toMatchObject({ latitude: MANUAL.lat, location_source: "manual" });

    // Flip source back to auto (no city change) — the trigger fires on location_source
    // and re-derives from the precise city name.
    await admin.from("zagrody").update({ location_source: "auto" }).eq("id", zagrodaId);
    expect(await readCoords(zagrodaId)).toMatchObject({
      latitude: PRECISE.lat,
      longitude: PRECISE.lng,
      location_precise: true,
      location_source: "auto",
    });
  });
});

describe("backfillZagrody — manual guard", () => {
  it("(c) skips manual zagrody, still updates auto ones", async () => {
    // Manual pin: must be untouched by the backfill.
    const { zagrodaId: manualId } = await seedOwned({ dailyLimit: 10, voivodeship: "mazowieckie", city: PRECISE_NAME });
    await setManualPin(manualId, MANUAL.lat, MANUAL.lng);

    // Auto zagroda published before its locality landed -> centroid, awaiting backfill.
    const autoCity = `Backfillowo${RUN}`;
    const AUTO = { lat: 53.05, lng: 20.45 };
    const { zagrodaId: autoId } = await seedOwned({ dailyLimit: 10, voivodeship: "mazowieckie", city: autoCity });
    expect(await readCoords(autoId)).toMatchObject({ location_precise: false, latitude: MAZ_CENTROID.lat });

    await seedLocality("mazowieckie", autoCity, AUTO.lat, AUTO.lng);
    await backfillZagrody(pg);

    // Manual pin unchanged; auto row re-resolved to the precise dictionary hit.
    expect(await readCoords(manualId)).toMatchObject({
      latitude: MANUAL.lat,
      longitude: MANUAL.lng,
      location_source: "manual",
    });
    expect(await readCoords(autoId)).toMatchObject({
      latitude: AUTO.lat,
      longitude: AUTO.lng,
      location_precise: true,
      location_source: "auto",
    });
  });
});

describe("zagrody_set_coords — auto derivation regression (S-10)", () => {
  it("(d) auto rows still derive precise-for-known, centroid-for-unknown", async () => {
    // Known city -> precise coords.
    const { zagrodaId } = await seedOwned({ dailyLimit: 10, voivodeship: "mazowieckie", city: PRECISE_NAME });
    expect(await readCoords(zagrodaId)).toMatchObject({
      latitude: PRECISE.lat,
      longitude: PRECISE.lng,
      location_precise: true,
      location_source: "auto",
    });

    // Unknown city -> voivodeship centroid, not precise.
    await admin
      .from("zagrody")
      .update({ city: `Nieznane${RUN}` })
      .eq("id", zagrodaId);
    expect(await readCoords(zagrodaId)).toMatchObject({
      latitude: MAZ_CENTROID.lat,
      longitude: MAZ_CENTROID.lng,
      location_precise: false,
      location_source: "auto",
    });
  });
});
