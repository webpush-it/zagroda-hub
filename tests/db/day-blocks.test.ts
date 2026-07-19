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

// S-08 day blocks (FR-022). A block means "day off", not "day full": it stops
// NEW demand on every surface (guest pending INSERT via trigger, acceptance
// and manual entry via soft day_blocked outcomes, catalog availability) but
// never touches existing accepted rows. Writes go exclusively through
// block_day()/unblock_day(); block_day takes the zagroda lock (demand-
// increasing), unblock_day does not (availability only grows).
//
// Seeding-order gotcha: the service-role seeder bypasses RLS but NOT the
// guard trigger — a pending fixture on a to-be-blocked day is seeded BEFORE
// block_day; the trigger rejection is asserted separately on an
// already-blocked day.

const PASSWORD = "test-password-123";

// Unique city scopes catalog_zagrody result sets to this suite's fixture
// (shared DB across suites; no reset between files).
const CITY = `Blokowo-${randomUUID().slice(0, 8)}`;

let admin: TypedClient;
let owner: TypedClient;
let ownerId: string;
let zagrodaId: string;
let turnusId: string;

beforeAll(async () => {
  admin = createAdminClient();
  const created = await createOwnerClient(uniqueEmail("blocks-owner"), PASSWORD);
  owner = created.client;
  ownerId = created.userId;
  const seeded = await seedZagroda(admin, { ownerId, dailyLimit: 30, published: true, city: CITY });
  zagrodaId = seeded.zagrodaId;
  turnusId = seeded.turnusIds[0];
});

async function blockDay(client: TypedClient, blockedDate: string, zagroda = zagrodaId) {
  const { data, error } = await client.rpc("block_day", { p_zagroda_id: zagroda, p_blocked_date: blockedDate });
  return { row: data?.[0], error };
}

async function unblockDay(client: TypedClient, blockedDate: string, zagroda = zagrodaId) {
  const { data, error } = await client.rpc("unblock_day", { p_zagroda_id: zagroda, p_blocked_date: blockedDate });
  return { row: data?.[0], error };
}

async function accept(client: TypedClient, requestId: string) {
  const { data, error } = await client.rpc("accept_booking_request", { request_id: requestId });
  return { row: data?.[0], error };
}

describe("block_day / unblock_day — semantics", () => {
  it("(a) owner blocks a day and can read the block; anon sees no day_blocks rows", async () => {
    const date = "2026-11-01";
    const { row, error } = await blockDay(owner, date);

    expect(error).toBeNull();
    expect(row).toMatchObject({ blocked: true, already_blocked: false });

    const { data: mine, error: mineError } = await owner
      .from("day_blocks")
      .select("blocked_date")
      .eq("zagroda_id", zagrodaId)
      .eq("blocked_date", date);
    expect(mineError).toBeNull();
    expect(mine).toHaveLength(1);

    const { data: anonRows, error: anonError } = await createAnonClient().from("day_blocks").select("*");
    expect(anonError).toBeNull();
    expect(anonRows).toHaveLength(0);
  });

  it("(b) blocking is idempotent: re-blocking reports already_blocked", async () => {
    const date = "2026-11-02";
    await blockDay(owner, date);

    const { row, error } = await blockDay(owner, date);

    expect(error).toBeNull();
    expect(row).toMatchObject({ blocked: true, already_blocked: true });
  });

  it("(c) unblocking a day that is not blocked is a soft outcome", async () => {
    const { row, error } = await unblockDay(owner, "2026-11-03");

    expect(error).toBeNull();
    expect(row).toMatchObject({ unblocked: false });
  });

  it("(d) a past date cannot be blocked (55000)", async () => {
    const { row, error } = await blockDay(owner, "2020-01-01");

    expect(row).toBeUndefined();
    expect(error?.code).toBe("55000"); // object_not_in_prerequisite_state
  });

  it("(e) a foreign owner gets 42501 from both block_day and unblock_day", async () => {
    const { client: stranger } = await createOwnerClient(uniqueEmail("blocks-stranger"), PASSWORD);

    const blocked = await blockDay(stranger, "2026-11-04");
    expect(blocked.row).toBeUndefined();
    expect(blocked.error?.code).toBe("42501"); // insufficient_privilege

    const unblocked = await unblockDay(stranger, "2026-11-04");
    expect(unblocked.row).toBeUndefined();
    expect(unblocked.error?.code).toBe("42501");
  });

  it("(f) anon has no EXECUTE grant on block_day / unblock_day", async () => {
    const anon = createAnonClient();

    const blocked = await blockDay(anon, "2026-11-05");
    expect(blocked.error?.code).toBe("42501"); // permission denied for function

    const unblocked = await unblockDay(anon, "2026-11-05");
    expect(unblocked.error?.code).toBe("42501");
  });
});

describe("day blocks — new demand is refused on every surface", () => {
  it("(g) acceptance on a blocked day is a soft day_blocked outcome; unblock restores it", async () => {
    const date = "2026-11-10";
    // Seed the pending request BEFORE blocking (the trigger guards pending inserts).
    const pending = await seedBookingRequest(admin, { zagrodaId, turnusId, tripDate: date, participants: 5 });
    await blockDay(owner, date);

    const refused = await accept(owner, pending);
    expect(refused.error).toBeNull();
    expect(refused.row).toMatchObject({
      accepted: false,
      day_blocked: true,
      occupied: 0,
      daily_limit: 30,
      requested: 5,
    });
    const { data: still } = await admin.from("booking_requests").select("status").eq("id", pending).single();
    expect(still?.status).toBe("pending");

    const { row: unblockRow } = await unblockDay(owner, date);
    expect(unblockRow).toMatchObject({ unblocked: true });

    const accepted = await accept(owner, pending);
    expect(accepted.error).toBeNull();
    expect(accepted.row).toMatchObject({ accepted: true, day_blocked: false });
  });

  it("(h) a manual entry on a blocked day is refused softly", async () => {
    const date = "2026-11-11";
    await blockDay(owner, date);

    const { data, error } = await owner.rpc("create_manual_booking", {
      p_zagroda_id: zagrodaId,
      p_turnus_id: turnusId,
      p_trip_date: date,
      p_participants: 5,
    });

    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ created: false, day_blocked: true, occupied: 0 });
    expect(data?.[0]?.request_id).toBeNull();
  });

  it("(i) a pending INSERT on an already-blocked day is rejected by the trigger — even for service_role", async () => {
    const date = "2026-11-12";
    await blockDay(owner, date);

    // Guest path (anon, RLS-visible).
    const { error: anonError } = await createAnonClient().from("booking_requests").insert({
      zagroda_id: zagrodaId,
      turnus_id: turnusId,
      trip_date: date,
      participants_count: 5,
      guest_name: "Anna Nauczycielka",
      guest_email: "anna@szkola.test",
      guest_phone: "+48 700 000 000",
    });
    expect(anonError?.code).toBe("55000"); // object_not_in_prerequisite_state
    expect(anonError?.message).toContain("day_blocked");

    // Service role bypasses RLS but NOT the trigger (the seeding-order gotcha).
    await expect(seedBookingRequest(admin, { zagrodaId, turnusId, tripDate: date, participants: 5 })).rejects.toThrow(
      /day_blocked/,
    );
  });

  it("(j) catalog_zagrody reports the blocked date unavailable and recovers after unblock", async () => {
    const date = "2026-11-13";
    const anon = createAnonClient();
    await blockDay(owner, date);

    const { data: blocked, error } = await anon.rpc("catalog_zagrody", { p_city: CITY, p_trip_date: date });
    expect(error).toBeNull();
    expect(blocked?.[0]?.is_available).toBe(false); // empty day, but blocked

    await unblockDay(owner, date);

    const { data: recovered } = await anon.rpc("catalog_zagrody", { p_city: CITY, p_trip_date: date });
    expect(recovered?.[0]?.is_available).toBe(true);
  });

  it("(k) blocking a day with existing accepted bookings succeeds and leaves them untouched", async () => {
    const date = "2026-11-14";
    const acceptedId = await seedBookingRequest(admin, {
      zagrodaId,
      turnusId,
      tripDate: date,
      participants: 10,
      status: "accepted",
    });

    const { row, error } = await blockDay(owner, date);

    expect(error).toBeNull();
    expect(row).toMatchObject({ blocked: true, already_blocked: false });
    const { data } = await admin
      .from("booking_requests")
      .select("status, participants_count")
      .eq("id", acceptedId)
      .single();
    expect(data).toMatchObject({ status: "accepted", participants_count: 10 });
  });
});
