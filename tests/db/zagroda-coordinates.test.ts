import { randomUUID } from "node:crypto";
import { Client as PgClient } from "pg";
import { inject } from "vitest";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createAdminClient,
  createAnonClient,
  createOwnerClient,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// S-10 coordinate layer (FR-020/FR-030): locality_coords resolves
// (voivodeship, free-text city) -> coords with a centroid fallback, the
// zagrody_set_coords trigger keeps zagrody coords in sync, and catalog_zagrody
// exposes the coordinates without touching its filters/sort/LIMIT. Distance
// itself is computed client-side (Phase 3) — nothing here sends guest location.

const PASSWORD = "test-password-123";

// Per-run suffix scopes this suite's localities/zagrody in the shared DB.
const RUN = randomUUID().slice(0, 8);

// A precise locality in mazowieckie and its centroid (from the migration).
const PRECISE_NAME = `Łąka${RUN}`;
const PRECISE_LAT = 52.5;
const PRECISE_LNG = 19.7;
const MAZ_CENTROID = { lat: 52.3, lng: 21.0 };

let admin: TypedClient;
let anon: TypedClient;

/** Inserts a locality; name_normalized is computed by the DB (single source of truth, F2). */
async function seedLocality(v: string, name: string, lat: number, lng: number): Promise<void> {
  const pg = new PgClient({ connectionString: inject("supabaseDbUrl") });
  await pg.connect();
  try {
    await pg.query(
      `insert into public.localities (voivodeship, name, name_normalized, latitude, longitude)
       values ($1::public.voivodeship, $2, public.locality_normalize($2), $3, $4)
       on conflict (voivodeship, name_normalized) do nothing`,
      [v, name, lat, lng],
    );
  } finally {
    await pg.end();
  }
}

/** Seeds a zagroda under a fresh owner (owner_id is UNIQUE — one each). */
async function seedOwned(opts: Omit<Parameters<typeof seedZagroda>[1], "ownerId">) {
  const { userId } = await createOwnerClient(uniqueEmail("geo-owner"), PASSWORD);
  return seedZagroda(admin, { ownerId: userId, ...opts });
}

async function readCoords(zagrodaId: string) {
  const { data, error } = await admin
    .from("zagrody")
    .select("latitude, longitude, location_precise")
    .eq("id", zagrodaId)
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error(`readCoords: no zagroda row for ${zagrodaId}`);
  return data;
}

beforeAll(async () => {
  admin = createAdminClient();
  anon = createAnonClient();
  await seedLocality("mazowieckie", PRECISE_NAME, PRECISE_LAT, PRECISE_LNG);
});

describe("locality_coords — resolution & fallback", () => {
  it("(a) dictionary hit returns precise coords with is_precise=true", async () => {
    const { data, error } = await admin.rpc("locality_coords", {
      p_voivodeship: "mazowieckie",
      p_city: PRECISE_NAME,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({ latitude: PRECISE_LAT, longitude: PRECISE_LNG, is_precise: true });
  });

  it("(b) miss falls back to the voivodeship centroid with is_precise=false", async () => {
    const { data, error } = await admin.rpc("locality_coords", {
      p_voivodeship: "mazowieckie",
      p_city: `Nieznane${RUN}`,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      latitude: MAZ_CENTROID.lat,
      longitude: MAZ_CENTROID.lng,
      is_precise: false,
    });
  });

  it("(c) normalization folds case, diacritics, 'ł' and surrounding spaces to the same hit", async () => {
    // Same locality typed four different ways — every variant must resolve precise.
    const variants = [
      PRECISE_NAME.toUpperCase(), // case
      `  ${PRECISE_NAME}  `, // surrounding spaces
      `Laka${RUN}`, // ascii input: 'ł'->'l', 'ą'->'a'
      `łąka${RUN}`, // lowercase diacritics
    ];
    for (const p_city of variants) {
      const { data, error } = await admin.rpc("locality_coords", { p_voivodeship: "mazowieckie", p_city });
      expect(error, `variant "${p_city}"`).toBeNull();
      expect(data, `variant "${p_city}"`).toHaveLength(1);
      expect(data?.[0], `variant "${p_city}"`).toMatchObject({ latitude: PRECISE_LAT, is_precise: true });
    }
  });

  it("empty/whitespace city resolves to no row (coords stay null on the caller)", async () => {
    // Null-voivodeship zero-row behavior is exercised end-to-end by the trigger
    // test below; the generated RPC Args type forbids a null p_voivodeship here.
    for (const p_city of ["", "   "]) {
      const { data, error } = await admin.rpc("locality_coords", { p_voivodeship: "mazowieckie", p_city });
      expect(error, `city "${p_city}"`).toBeNull();
      expect(data, `city "${p_city}"`).toHaveLength(0);
    }
  });
});

describe("zagrody_set_coords — trigger", () => {
  it("(d) sets coords on insert and re-resolves on city/voivodeship update", async () => {
    // Insert with a precise city -> precise coords.
    const { zagrodaId } = await seedOwned({
      dailyLimit: 10,
      published: true,
      voivodeship: "mazowieckie",
      city: PRECISE_NAME,
    });
    expect(await readCoords(zagrodaId)).toMatchObject({
      latitude: PRECISE_LAT,
      longitude: PRECISE_LNG,
      location_precise: true,
    });

    // Update city to an unknown one -> centroid, not precise.
    await admin
      .from("zagrody")
      .update({ city: `Nieznane${RUN}` })
      .eq("id", zagrodaId);
    expect(await readCoords(zagrodaId)).toMatchObject({
      latitude: MAZ_CENTROID.lat,
      longitude: MAZ_CENTROID.lng,
      location_precise: false,
    });

    // Clearing city -> no row from resolver -> null coords, location_precise coalesces to false.
    await admin.from("zagrody").update({ city: null }).eq("id", zagrodaId);
    expect(await readCoords(zagrodaId)).toMatchObject({
      latitude: null,
      longitude: null,
      location_precise: false,
    });
  });

  it("a zagroda with no voivodeship keeps null coords (zero-row-safety, F5)", async () => {
    const { zagrodaId } = await seedOwned({ dailyLimit: 10, voivodeship: null, city: PRECISE_NAME });
    expect(await readCoords(zagrodaId)).toMatchObject({
      latitude: null,
      longitude: null,
      location_precise: false,
    });
  });
});

describe("catalog_zagrody — coordinate columns", () => {
  it("(e) exposes latitude/longitude/location_precise while filters still hold", async () => {
    const cityFilter = `Coords${RUN}`;
    await seedLocality("mazowieckie", cityFilter, PRECISE_LAT, PRECISE_LNG);
    const { zagrodaId } = await seedOwned({
      dailyLimit: 10,
      published: true,
      voivodeship: "mazowieckie",
      city: cityFilter,
    });

    const { data, error } = await anon.rpc("catalog_zagrody", { p_voivodeship: "mazowieckie", p_city: cityFilter });
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([zagrodaId]);
    expect(data?.[0]).toMatchObject({
      latitude: PRECISE_LAT,
      longitude: PRECISE_LNG,
      location_precise: true,
    });
  });
});
