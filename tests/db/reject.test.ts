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

// S-04 owner reject primitive. reject_booking_request is the only
// pending -> rejected transition (authenticated-only SECURITY DEFINER; no
// UPDATE policy). Ownership is checked before any state-dependent return,
// non-pending states are soft outcomes (mirroring cancel_booking_request),
// and the immutable lock-order columns are never touched.

const PASSWORD = "test-password-123";

let admin: TypedClient;
let owner: TypedClient;
let ownerId: string;
let zagrodaId: string;
let turnusId: string;

beforeAll(async () => {
  admin = createAdminClient();
  const created = await createOwnerClient(uniqueEmail("reject-owner"), PASSWORD);
  owner = created.client;
  ownerId = created.userId;
  const seeded = await seedZagroda(admin, { ownerId, dailyLimit: 30 });
  zagrodaId = seeded.zagrodaId;
  turnusId = seeded.turnusIds[0];
});

async function reject(client: TypedClient, requestId: string) {
  const { data, error } = await client.rpc("reject_booking_request", { request_id: requestId });
  return { row: data?.[0], error };
}

async function rowOf(id: string) {
  const { data, error } = await admin
    .from("booking_requests")
    .select("status, zagroda_id, turnus_id, trip_date")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

describe("reject_booking_request — owner reject", () => {
  it("(a) owner rejects a pending request; immutable columns untouched", async () => {
    const id = await seedBookingRequest(admin, {
      zagrodaId,
      turnusId,
      tripDate: "2026-08-01",
      participants: 5,
    });
    const before = await rowOf(id);

    const { row, error } = await reject(owner, id);

    expect(error).toBeNull();
    expect(row).toMatchObject({ rejected: true, status: "rejected" });
    const after = await rowOf(id);
    expect(after).toMatchObject({
      status: "rejected",
      zagroda_id: before.zagroda_id,
      turnus_id: before.turnus_id,
      trip_date: before.trip_date,
    });
  });

  it("(b) a non-owner authenticated caller gets 42501 regardless of state", async () => {
    const id = await seedBookingRequest(admin, {
      zagrodaId,
      turnusId,
      tripDate: "2026-08-02",
      participants: 5,
    });
    const { client: stranger } = await createOwnerClient(uniqueEmail("reject-stranger"), PASSWORD);

    const { row, error } = await reject(stranger, id);

    expect(row).toBeUndefined();
    expect(error?.code).toBe("42501"); // insufficient_privilege
    await expect(rowOf(id).then((r) => r.status)).resolves.toBe("pending");
  });

  it("(c) an unknown request id raises P0002", async () => {
    const { row, error } = await reject(owner, randomUUID());

    expect(row).toBeUndefined();
    expect(error?.code).toBe("P0002"); // no_data_found
  });

  it("(d) non-pending states are soft outcomes; row left unchanged", async () => {
    for (const status of ["accepted", "cancelled_by_guest"] as const) {
      const id = await seedBookingRequest(admin, {
        zagrodaId,
        turnusId,
        tripDate: "2026-08-03",
        participants: 5,
        status,
      });

      const { row, error } = await reject(owner, id);

      expect(error).toBeNull();
      expect(row).toMatchObject({ rejected: false, status });
      await expect(rowOf(id).then((r) => r.status)).resolves.toBe(status);
    }
  });

  it("(e) anon has no EXECUTE grant", async () => {
    const id = await seedBookingRequest(admin, {
      zagrodaId,
      turnusId,
      tripDate: "2026-08-04",
      participants: 5,
    });
    const anon = createAnonClient();

    const { row, error } = await reject(anon, id);

    expect(row).toBeUndefined();
    expect(error?.code).toBe("42501"); // permission denied for function
    await expect(rowOf(id).then((r) => r.status)).resolves.toBe("pending");
  });

  it("(f) a rejected request cannot subsequently be accepted", async () => {
    const id = await seedBookingRequest(admin, {
      zagrodaId,
      turnusId,
      tripDate: "2026-08-05",
      participants: 5,
    });
    await reject(owner, id);

    const { data, error } = await owner.rpc("accept_booking_request", { request_id: id });

    expect(data?.[0]).toBeUndefined();
    expect(error?.code).toBe("55000"); // object_not_in_prerequisite_state
    await expect(rowOf(id).then((r) => r.status)).resolves.toBe("rejected");
  });

  it("(g) rejecting does not change occupancy for the day", async () => {
    // Two pending requests on the same fresh day: reject one, accept the
    // other — the acceptance must see occupied=0 (rejected rows never count).
    const rejectedId = await seedBookingRequest(admin, {
      zagrodaId,
      turnusId,
      tripDate: "2026-08-06",
      participants: 10,
    });
    const acceptedId = await seedBookingRequest(admin, {
      zagrodaId,
      turnusId,
      tripDate: "2026-08-06",
      participants: 5,
    });

    await reject(owner, rejectedId);
    const { data, error } = await owner.rpc("accept_booking_request", { request_id: acceptedId });

    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ accepted: true, occupied: 0, daily_limit: 30, requested: 5 });
  });
});
