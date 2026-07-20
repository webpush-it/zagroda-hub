import { randomUUID } from "node:crypto";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { backfillZagrody, loadLocalities, parseLocalitiesCsv, type LocalityRow } from "../../scripts/seed-localities";
import { createAdminClient, createOwnerClient, seedZagroda, uniqueEmail, type TypedClient } from "../helpers/supabase";

// S-10 Phase 2: the seed/backfill script (scripts/seed-localities.ts). These
// exercise the load + backfill LOGIC against a small fixture — the full 90k
// asset load is verified separately via `npm run db:seed-localities`. Names
// carry a per-run suffix so this suite is isolated in the shared DB and
// re-runnable. loadLocalities computes name_normalized in the DB (single source
// of truth, F2); the fixture only supplies raw names + coords.

const PASSWORD = "test-password-123";
const RUN = randomUUID().slice(0, 8);
const MAZ_CENTROID = { lat: 52.3, lng: 21.0 };

let admin: TypedClient;
let pg: PgClient;

async function seedOwned(opts: Omit<Parameters<typeof seedZagroda>[1], "ownerId">) {
  const { userId } = await createOwnerClient(uniqueEmail("seed-owner"), PASSWORD);
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

/** Count dictionary rows whose raw name matches (unique per RUN, so 0 or 1). */
async function countLocality(name: string): Promise<number> {
  const { rows } = await pg.query<{ count: string }>(
    "select count(*) as count from public.localities where name = $1",
    [name],
  );
  return Number(rows[0]?.count ?? 0);
}

beforeAll(async () => {
  admin = createAdminClient();
  pg = new PgClient({ connectionString: inject("supabaseDbUrl") });
  await pg.connect();
});

afterAll(async () => {
  await pg.end();
});

describe("parseLocalitiesCsv", () => {
  it("reads plain rows and RFC-4180 quoted names with embedded quotes", () => {
    const csv =
      "voivodeship,name,latitude,longitude\n" +
      "mazowieckie,Płock,52.54639,19.68667\n" +
      'mazowieckie,"Mazewo Dworskie""A""",52.61639,20.74333\n';
    expect(parseLocalitiesCsv(csv)).toEqual<LocalityRow[]>([
      { voivodeship: "mazowieckie", name: "Płock", latitude: 52.54639, longitude: 19.68667 },
      { voivodeship: "mazowieckie", name: 'Mazewo Dworskie"A"', latitude: 52.61639, longitude: 20.74333 },
    ]);
  });

  it("ignores a trailing newline without emitting a blank row", () => {
    expect(parseLocalitiesCsv("voivodeship,name,latitude,longitude\nmazowieckie,Radom,51.4,21.15\n")).toHaveLength(1);
  });
});

describe("loadLocalities — upsert", () => {
  it("(a) is idempotent: loading twice leaves one row with unchanged coords", async () => {
    const name = `Seedowo${RUN}`;
    const fixture: LocalityRow[] = [{ voivodeship: "mazowieckie", name, latitude: 52.9, longitude: 20.1 }];

    await loadLocalities(pg, fixture);
    expect(await countLocality(name)).toBe(1);

    await loadLocalities(pg, fixture);
    expect(await countLocality(name)).toBe(1);

    const { rows } = await pg.query<{ latitude: number; longitude: number }>(
      "select latitude, longitude from public.localities where name = $1",
      [name],
    );
    expect(rows[0]).toMatchObject({ latitude: 52.9, longitude: 20.1 });
  });
});

describe("backfillZagrody", () => {
  it("(b) resolves precise coords for a zagroda published before its locality existed", async () => {
    const city = `Backfillowo${RUN}`;
    const CITY = { lat: 53.11, lng: 20.55 };

    // Published before the locality is in the dictionary -> trigger sets centroid.
    const { zagrodaId } = await seedOwned({ dailyLimit: 10, published: true, voivodeship: "mazowieckie", city });
    expect(await readCoords(zagrodaId)).toMatchObject({ location_precise: false, latitude: MAZ_CENTROID.lat });

    // Dictionary gains the locality; backfill re-resolves it to precise coords.
    await loadLocalities(pg, [{ voivodeship: "mazowieckie", name: city, latitude: CITY.lat, longitude: CITY.lng }]);
    await backfillZagrody(pg);

    expect(await readCoords(zagrodaId)).toMatchObject({
      latitude: CITY.lat,
      longitude: CITY.lng,
      location_precise: true,
    });
  });

  it("(c) leaves an unknown city on the voivodeship centroid with location_precise=false", async () => {
    const { zagrodaId } = await seedOwned({
      dailyLimit: 10,
      published: true,
      voivodeship: "mazowieckie",
      city: `Zupełnie Nieznane${RUN}`,
    });
    await backfillZagrody(pg);
    expect(await readCoords(zagrodaId)).toMatchObject({
      latitude: MAZ_CENTROID.lat,
      longitude: MAZ_CENTROID.lng,
      location_precise: false,
    });
  });
});
