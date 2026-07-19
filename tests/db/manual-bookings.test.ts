import { beforeAll, describe, expect, it } from "vitest";
import {
  createAdminClient,
  createAnonClient,
  createOwnerClient,
  isoDate,
  seedBookingRequest,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// S-08 manual phone entries (FR-021/023). create_manual_booking inserts a
// booking_requests row born accepted with source = 'phone' and no guest
// contact, under the SAME zagroda lock as acceptances — so the entry consumes
// capacity through the one anti-overbooking rule (the parallel proof lives in
// concurrency.test.ts). Removal reuses withdraw_booking_request unchanged.
// Tests share one owner + zagroda; isolation comes from distinct trip dates
// (occupancy is per (zagroda_id, trip_date)).

const PASSWORD = "test-password-123";

let admin: TypedClient;
let owner: TypedClient;
let ownerId: string;
let zagrodaId: string;
let turnusId: string;

beforeAll(async () => {
  admin = createAdminClient();
  const created = await createOwnerClient(uniqueEmail("manual-owner"), PASSWORD);
  owner = created.client;
  ownerId = created.userId;
  const seeded = await seedZagroda(admin, { ownerId, dailyLimit: 30 });
  zagrodaId = seeded.zagrodaId;
  turnusId = seeded.turnusIds[0];
});

async function createManual(
  client: TypedClient,
  opts: { tripDate: string; participants: number; note?: string; zagroda?: string; turnus?: string },
) {
  const { data, error } = await client.rpc("create_manual_booking", {
    p_zagroda_id: opts.zagroda ?? zagrodaId,
    p_turnus_id: opts.turnus ?? turnusId,
    p_trip_date: opts.tripDate,
    p_participants: opts.participants,
    ...(opts.note !== undefined ? { p_note: opts.note } : {}),
  });
  return { row: data?.[0], error };
}

async function accept(client: TypedClient, requestId: string) {
  const { data, error } = await client.rpc("accept_booking_request", { request_id: requestId });
  return { row: data?.[0], error };
}

describe("create_manual_booking — manual phone entries", () => {
  it("(a) creates an accepted phone row with note and no guest contact", async () => {
    const { row, error } = await createManual(owner, {
      tripDate: isoDate(30),
      participants: 10,
      note: "Pani Kasia, szkoła nr 5",
    });

    expect(error).toBeNull();
    expect(row).toMatchObject({ created: true, day_blocked: false, occupied: 0, daily_limit: 30, requested: 10 });
    expect(row?.request_id).toBeTruthy();

    const { data, error: readError } = await admin
      .from("booking_requests")
      .select("status, source, note, participants_count, guest_name, guest_email, guest_phone")
      .eq("id", row?.request_id ?? "")
      .single();
    expect(readError).toBeNull();
    expect(data).toMatchObject({
      status: "accepted",
      source: "phone",
      note: "Pani Kasia, szkoła nr 5",
      participants_count: 10,
      guest_name: null,
      guest_email: null,
      guest_phone: null,
    });
  });

  it("(b) an entry consumes capacity: a colliding acceptance is refused with the entry's seats", async () => {
    const tripDate = isoDate(31);
    const { row: entry } = await createManual(owner, { tripDate, participants: 20 });
    expect(entry?.created).toBe(true);

    const pending = await seedBookingRequest(admin, { zagrodaId, turnusId, tripDate, participants: 15 });
    const { row, error } = await accept(owner, pending);

    expect(error).toBeNull();
    expect(row).toMatchObject({ accepted: false, day_blocked: false, occupied: 20, daily_limit: 30, requested: 15 });
    const { data } = await admin.from("booking_requests").select("status").eq("id", pending).single();
    expect(data?.status).toBe("pending");
  });

  it("(c) an over-limit entry is refused softly with honest numbers; no row is inserted", async () => {
    const tripDate = isoDate(32);
    await seedBookingRequest(admin, { zagrodaId, turnusId, tripDate, participants: 20, status: "accepted" });

    const { row, error } = await createManual(owner, { tripDate, participants: 15 });

    expect(error).toBeNull();
    expect(row).toMatchObject({ created: false, day_blocked: false, occupied: 20, daily_limit: 30, requested: 15 });
    expect(row?.request_id).toBeNull();

    const { data } = await admin
      .from("booking_requests")
      .select("id")
      .eq("zagroda_id", zagrodaId)
      .eq("trip_date", tripDate)
      .eq("source", "phone");
    expect(data).toHaveLength(0);
  });

  it("(d) withdraw_booking_request works unchanged on a phone entry and frees the seats instantly", async () => {
    const tripDate = isoDate(33);
    const { row: entry } = await createManual(owner, { tripDate, participants: 25 });
    expect(entry?.created).toBe(true);

    const { data: withdrawData, error: withdrawError } = await owner.rpc("withdraw_booking_request", {
      request_id: entry?.request_id ?? "",
    });
    expect(withdrawError).toBeNull();
    expect(withdrawData?.[0]).toMatchObject({ withdrawn: true, status: "withdrawn_by_owner" });

    // Full-day acceptance fits immediately — the seats are back.
    const pending = await seedBookingRequest(admin, { zagrodaId, turnusId, tripDate, participants: 30 });
    const { row, error } = await accept(owner, pending);
    expect(error).toBeNull();
    expect(row).toMatchObject({ accepted: true, occupied: 0, daily_limit: 30, requested: 30 });
  });

  it("(e) a foreign owner gets 42501 and no entry is created", async () => {
    const { client: stranger } = await createOwnerClient(uniqueEmail("manual-stranger"), PASSWORD);

    const { row, error } = await createManual(stranger, { tripDate: isoDate(34), participants: 5 });

    expect(row).toBeUndefined();
    expect(error?.code).toBe("42501"); // insufficient_privilege
  });

  it("(f) a past trip date is a hard 55000", async () => {
    const { row, error } = await createManual(owner, { tripDate: isoDate(-30), participants: 5 });

    expect(row).toBeUndefined();
    expect(error?.code).toBe("55000"); // object_not_in_prerequisite_state
  });

  it("(g) anon has no EXECUTE grant", async () => {
    const anon = createAnonClient();

    const { row, error } = await createManual(anon, { tripDate: isoDate(35), participants: 5 });

    expect(row).toBeUndefined();
    expect(error?.code).toBe("42501"); // permission denied for function
  });

  it("(h) neither anon nor an authenticated guest can forge source='phone' via direct INSERT", async () => {
    const forged = {
      zagroda_id: zagrodaId,
      turnus_id: turnusId,
      trip_date: isoDate(36),
      participants_count: 5,
      status: "pending",
      source: "phone",
      guest_name: "Fałszerz",
      guest_email: "falszerz@test.local",
      guest_phone: "+48 600 111 222",
    } as const;

    const { error: anonError } = await createAnonClient().from("booking_requests").insert(forged);
    expect(anonError?.code).toBe("42501"); // RLS WITH CHECK violation

    const { error: authError } = await owner.from("booking_requests").insert(forged);
    expect(authError?.code).toBe("42501"); // RLS WITH CHECK violation
  });
});
