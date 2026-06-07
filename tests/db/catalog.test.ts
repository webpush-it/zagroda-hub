import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createAdminClient,
  createAnonClient,
  createOwnerClient,
  seedBookingRequest,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// Proof of the S-02 catalog read semantics (FR-001/002/003): catalog_zagrody
// is SECURITY DEFINER, so RLS does not protect it — the function must
// self-enforce the publish gate, filter location with AND (case-insensitive
// city), derive availability from accepted-only occupancy (same math as
// accept_booking_request), sort available-first/newest-first, and expose no
// guest data on any anon-reachable surface.

const PASSWORD = "test-password-123";

// City names carry a per-run suffix so RPC result sets can be scoped to this
// suite's fixtures (the DB is shared across suites; no reset between files).
const RUN = randomUUID().slice(0, 8);
const city = (name: string) => `${name}-${RUN}`;

let admin: TypedClient;
let anon: TypedClient;

/** Seeds a zagroda under a fresh owner (owner_id is UNIQUE — one each). */
async function seedOwned(opts: Omit<Parameters<typeof seedZagroda>[1], "ownerId">) {
  const { userId } = await createOwnerClient(uniqueEmail("cat-owner"), PASSWORD);
  return seedZagroda(admin, { ownerId: userId, ...opts });
}

beforeAll(() => {
  admin = createAdminClient();
  anon = createAnonClient();
});

describe("catalog_zagrody — publish gate", () => {
  let publishedId: string;
  let draftId: string;
  let draftOwner: TypedClient;

  beforeAll(async () => {
    const pub = await createOwnerClient(uniqueEmail("cat-pub"), PASSWORD);
    publishedId = (
      await seedZagroda(admin, { ownerId: pub.userId, dailyLimit: 10, published: true, city: city("Gate") })
    ).zagrodaId;

    const draft = await createOwnerClient(uniqueEmail("cat-draft"), PASSWORD);
    draftOwner = draft.client;
    draftId = (await seedZagroda(admin, { ownerId: draft.userId, dailyLimit: 10, city: city("Gate") })).zagrodaId;
  });

  it("(a) anon gets published zagrody, never drafts", async () => {
    const { data, error } = await anon.rpc("catalog_zagrody", { p_city: city("Gate") });
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toContain(publishedId);
    expect(ids).not.toContain(draftId);
  });

  it("(b) drafts stay hidden from the RPC even for their own owner", async () => {
    // SECURITY DEFINER means the authenticated-owner RLS policy ("published
    // or own") does NOT apply — the function's own publish gate must hold.
    const { data, error } = await draftOwner.rpc("catalog_zagrody", { p_city: city("Gate") });
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toContain(publishedId);
    expect(ids).not.toContain(draftId);
  });
});

describe("catalog_zagrody — location filters", () => {
  let mazPlockId: string;
  let mazRadomId: string;
  let pomPlockId: string;

  beforeAll(async () => {
    mazPlockId = (await seedOwned({ dailyLimit: 10, published: true, voivodeship: "mazowieckie", city: city("Płock") }))
      .zagrodaId;
    mazRadomId = (await seedOwned({ dailyLimit: 10, published: true, voivodeship: "mazowieckie", city: city("Radom") }))
      .zagrodaId;
    pomPlockId = (await seedOwned({ dailyLimit: 10, published: true, voivodeship: "pomorskie", city: city("Płock") }))
      .zagrodaId;
  });

  it("(c) voivodeship + city filter as AND; city matches case-insensitively on trimmed input", async () => {
    // Same city name in two voivodeships — AND keeps only the matching pair.
    // Uppercased + padded input must still match (lower(trim(...)) both sides).
    const { data, error } = await anon.rpc("catalog_zagrody", {
      p_voivodeship: "mazowieckie",
      p_city: `  ${city("Płock").toUpperCase()}  `,
    });
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([mazPlockId]);

    const { data: pom } = await anon.rpc("catalog_zagrody", { p_voivodeship: "pomorskie", p_city: city("Płock") });
    expect((pom ?? []).map((r) => r.id)).toEqual([pomPlockId]);

    // Voivodeship alone: both mazowieckie rows, never the pomorskie one.
    const { data: maz } = await anon.rpc("catalog_zagrody", { p_voivodeship: "mazowieckie" });
    const mazIds = (maz ?? []).map((r) => r.id);
    expect(mazIds).toContain(mazPlockId);
    expect(mazIds).toContain(mazRadomId);
    expect(mazIds).not.toContain(pomPlockId);
  });

  it("(d) without p_trip_date, is_available is null for every row", async () => {
    const { data, error } = await anon.rpc("catalog_zagrody", { p_city: city("Płock") });
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    for (const row of data ?? []) expect(row.is_available).toBeNull();
  });
});

describe("catalog_zagrody — availability (accepted-only occupancy)", () => {
  const DAY = "2026-08-20";

  it("(e) only accepted bookings count toward occupancy", async () => {
    // limit 10, accepted 5 — plus 5 participants in EVERY other status on the
    // same day. If any non-accepted row counted, occupancy would exceed 10
    // and the 5-participant query below would flip to unavailable.
    const { zagrodaId, turnusIds } = await seedOwned({ dailyLimit: 10, published: true, city: city("Statusy") });
    const base = { zagrodaId, turnusId: turnusIds[0], tripDate: DAY, participants: 5 };
    await seedBookingRequest(admin, { ...base, status: "accepted" });
    await seedBookingRequest(admin, { ...base, status: "pending" });
    await seedBookingRequest(admin, { ...base, status: "rejected" });
    await seedBookingRequest(admin, { ...base, status: "cancelled_by_guest" });
    await seedBookingRequest(admin, { ...base, status: "withdrawn_by_owner" });

    const { data: fits } = await anon.rpc("catalog_zagrody", {
      p_city: city("Statusy"),
      p_trip_date: DAY,
      p_participants: 5,
    });
    expect(fits?.[0]?.is_available).toBe(true); // occupied is exactly 5

    // ...while the accepted row itself DOES count: 5 + 6 > 10.
    const { data: over } = await anon.rpc("catalog_zagrody", {
      p_city: city("Statusy"),
      p_trip_date: DAY,
      p_participants: 6,
    });
    expect(over?.[0]?.is_available).toBe(false);
  });

  it("(f) boundary: occupied + requested = limit is available; one more is not", async () => {
    const { zagrodaId, turnusIds } = await seedOwned({ dailyLimit: 20, published: true, city: city("Granica") });
    await seedBookingRequest(admin, {
      zagrodaId,
      turnusId: turnusIds[0],
      tripDate: DAY,
      participants: 15,
      status: "accepted",
    });

    const { data: exact } = await anon.rpc("catalog_zagrody", {
      p_city: city("Granica"),
      p_trip_date: DAY,
      p_participants: 5,
    });
    expect(exact?.[0]?.is_available).toBe(true); // 15 + 5 = 20 <= 20

    const { data: over } = await anon.rpc("catalog_zagrody", {
      p_city: city("Granica"),
      p_trip_date: DAY,
      p_participants: 6,
    });
    expect(over?.[0]?.is_available).toBe(false); // 15 + 6 = 21 > 20
  });

  it("(g) date alone defaults participants to 1; sub-1 input clamps to 1", async () => {
    const full = await seedOwned({ dailyLimit: 10, published: true, city: city("Pełna") });
    await seedBookingRequest(admin, {
      zagrodaId: full.zagrodaId,
      turnusId: full.turnusIds[0],
      tripDate: DAY,
      participants: 10,
      status: "accepted",
    });
    const oneSpot = await seedOwned({ dailyLimit: 10, published: true, city: city("Luźna") });
    await seedBookingRequest(admin, {
      zagrodaId: oneSpot.zagrodaId,
      turnusId: oneSpot.turnusIds[0],
      tripDate: DAY,
      participants: 9,
      status: "accepted",
    });

    // No p_participants at all → defaults to 1.
    const { data: fullRows } = await anon.rpc("catalog_zagrody", { p_city: city("Pełna"), p_trip_date: DAY });
    expect(fullRows?.[0]?.is_available).toBe(false); // 10 + 1 > 10

    const { data: oneSpotRows } = await anon.rpc("catalog_zagrody", { p_city: city("Luźna"), p_trip_date: DAY });
    expect(oneSpotRows?.[0]?.is_available).toBe(true); // 9 + 1 <= 10

    // Explicit 0 clamps to 1 — same outcomes as above.
    const { data: clamped } = await anon.rpc("catalog_zagrody", {
      p_city: city("Pełna"),
      p_trip_date: DAY,
      p_participants: 0,
    });
    expect(clamped?.[0]?.is_available).toBe(false);
  });

  it("(h) date filter sorts unavailable after available; newest first within a tier", async () => {
    // Sequential seeding gives strictly increasing created_at.
    const oldest = await seedOwned({ dailyLimit: 10, published: true, city: city("Sort") });
    const booked = await seedOwned({ dailyLimit: 10, published: true, city: city("Sort") });
    const newest = await seedOwned({ dailyLimit: 10, published: true, city: city("Sort") });
    await seedBookingRequest(admin, {
      zagrodaId: booked.zagrodaId,
      turnusId: booked.turnusIds[0],
      tripDate: DAY,
      participants: 10,
      status: "accepted",
    });

    const { data: withDate } = await anon.rpc("catalog_zagrody", { p_city: city("Sort"), p_trip_date: DAY });
    expect((withDate ?? []).map((r) => r.id)).toEqual([newest.zagrodaId, oldest.zagrodaId, booked.zagrodaId]);

    // Without a date there is no availability tier — pure newest first.
    const { data: noDate } = await anon.rpc("catalog_zagrody", { p_city: city("Sort") });
    expect((noDate ?? []).map((r) => r.id)).toEqual([newest.zagrodaId, booked.zagrodaId, oldest.zagrodaId]);
  });
});

describe("catalog_zagrody — guest-data privacy", () => {
  it("(i) rows expose only profile fields and anon still cannot read booking_requests", async () => {
    const { zagrodaId, turnusIds } = await seedOwned({ dailyLimit: 10, published: true, city: city("Prywatność") });
    await seedBookingRequest(admin, {
      zagrodaId,
      turnusId: turnusIds[0],
      tripDate: "2026-08-21",
      participants: 3,
      status: "accepted",
    });

    const { data, error } = await anon.rpc("catalog_zagrody", { p_city: city("Prywatność") });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    // Shape check: nothing from booking_requests beyond the derived boolean.
    expect(Object.keys(data?.[0] ?? {}).sort()).toEqual([
      "city",
      "created_at",
      "daily_limit",
      "description",
      "id",
      "is_available",
      "name",
      "photo_path",
      "voivodeship",
    ]);

    // Regression alongside rls.test.ts (c): the new function must remain the
    // only anon-reachable surface over booking_requests.
    const { data: requests, error: requestsError } = await anon.from("booking_requests").select("*");
    expect(requestsError).toBeNull();
    expect(requests).toHaveLength(0);
  });
});
