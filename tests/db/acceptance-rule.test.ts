import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createAdminClient,
  createOwnerClient,
  seedBookingRequest,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// Sequential matrix of the daily-limit rule (outside the race — see
// concurrency.test.ts for the parallel proof). Each case gets its own
// owner + zagroda: owner_id is UNIQUE on zagrody (1 account = 1 zagroda).

const PASSWORD = "test-password-123";

interface Fixture {
  owner: TypedClient;
  ownerId: string;
  zagrodaId: string;
  turnusIds: string[];
}

let admin: TypedClient;

async function seedFixture(dailyLimit: number, turnusCount = 1): Promise<Fixture> {
  const { client: owner, userId } = await createOwnerClient(uniqueEmail(), PASSWORD);
  const { zagrodaId, turnusIds } = await seedZagroda(admin, { ownerId: userId, dailyLimit, turnusCount });
  return { owner, ownerId: userId, zagrodaId, turnusIds };
}

async function accept(client: TypedClient, requestId: string) {
  const { data, error } = await client.rpc("accept_booking_request", { request_id: requestId });
  return { row: data?.[0], error };
}

async function statusOf(requestId: string) {
  const { data, error } = await admin.from("booking_requests").select("status").eq("id", requestId).single();
  if (error) throw new Error(error.message);
  return data.status;
}

beforeAll(() => {
  admin = createAdminClient();
});

describe("accept_booking_request — daily limit rule", () => {
  it("(a) accepts a request that fits within the limit", async () => {
    const f = await seedFixture(30);
    const requestId = await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-01",
      participants: 10,
    });

    const { row, error } = await accept(f.owner, requestId);

    expect(error).toBeNull();
    expect(row).toMatchObject({ accepted: true, occupied: 0, daily_limit: 30, requested: 10 });
    await expect(statusOf(requestId)).resolves.toBe("accepted");
  });

  it("(b) accepts an exact fill of the limit (sum == limit)", async () => {
    const f = await seedFixture(30);
    await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-01",
      participants: 20,
      status: "accepted",
    });
    const requestId = await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-01",
      participants: 10,
    });

    const { row, error } = await accept(f.owner, requestId);

    expect(error).toBeNull();
    expect(row).toMatchObject({ accepted: true, occupied: 20, daily_limit: 30, requested: 10 });
    await expect(statusOf(requestId)).resolves.toBe("accepted");
  });

  it("(c) blocks a request that exceeds the limit; result row carries the numbers; status stays pending", async () => {
    const f = await seedFixture(30);
    await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-01",
      participants: 20,
      status: "accepted",
    });
    const requestId = await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-01",
      participants: 15,
    });

    const { row, error } = await accept(f.owner, requestId);

    expect(error).toBeNull();
    expect(row).toMatchObject({ accepted: false, occupied: 20, daily_limit: 30, requested: 15 });
    await expect(statusOf(requestId)).resolves.toBe("pending");
  });

  it("(d) freed seats (withdrawn_by_owner / cancelled_by_guest) make room for the next acceptance", async () => {
    const f = await seedFixture(30);
    const blocking = await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-01",
      participants: 25,
      status: "accepted",
    });
    const requestId = await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-01",
      participants: 15,
    });

    // Over the limit while the 25 seats are taken.
    const blocked = await accept(f.owner, requestId);
    expect(blocked.row?.accepted).toBe(false);

    // Withdrawal functions are S-05/S-03 — simulate with a direct admin UPDATE.
    const { error: updateError } = await admin
      .from("booking_requests")
      .update({ status: "withdrawn_by_owner" })
      .eq("id", blocking);
    expect(updateError).toBeNull();

    const { row, error } = await accept(f.owner, requestId);
    expect(error).toBeNull();
    expect(row).toMatchObject({ accepted: true, occupied: 0, daily_limit: 30, requested: 15 });
  });

  it("(e) the sum is per day across ALL turnusy, not per turnus", async () => {
    const f = await seedFixture(30, 2);
    await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-01",
      participants: 20,
      status: "accepted",
    });
    // Different turnus, same day — still counts against the same daily limit.
    const requestId = await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[1],
      tripDate: "2026-07-01",
      participants: 15,
    });

    const { row, error } = await accept(f.owner, requestId);

    expect(error).toBeNull();
    expect(row).toMatchObject({ accepted: false, occupied: 20, daily_limit: 30, requested: 15 });
  });

  it("(f) different days are independent", async () => {
    const f = await seedFixture(30);
    await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-01",
      participants: 30,
      status: "accepted",
    });
    const requestId = await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-02",
      participants: 30,
    });

    const { row, error } = await accept(f.owner, requestId);

    expect(error).toBeNull();
    expect(row).toMatchObject({ accepted: true, occupied: 0, daily_limit: 30, requested: 30 });
  });

  it("(g) grandfathering: when the sum already exceeds a lowered limit, every new acceptance is blocked", async () => {
    const f = await seedFixture(30);
    await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-01",
      participants: 30,
      status: "accepted",
    });
    // Lowering the limit below the current sum is legal (no blocking validation).
    const { error: limitError } = await admin.from("zagrody").update({ daily_limit: 10 }).eq("id", f.zagrodaId);
    expect(limitError).toBeNull();

    const requestId = await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-01",
      participants: 1,
    });

    const { row, error } = await accept(f.owner, requestId);

    expect(error).toBeNull();
    expect(row).toMatchObject({ accepted: false, occupied: 30, daily_limit: 10, requested: 1 });
    await expect(statusOf(requestId)).resolves.toBe("pending");
  });

  it("(h1) hard error: caller who is not the owner gets an exception", async () => {
    const f = await seedFixture(30);
    const requestId = await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-01",
      participants: 10,
    });
    const { client: stranger } = await createOwnerClient(uniqueEmail("stranger"), PASSWORD);

    const { row, error } = await accept(stranger, requestId);

    expect(row).toBeUndefined();
    expect(error?.code).toBe("42501"); // insufficient_privilege
    await expect(statusOf(requestId)).resolves.toBe("pending");
  });

  it("(h2) hard error: a request that is not pending gets an exception", async () => {
    const f = await seedFixture(30);
    const requestId = await seedBookingRequest(admin, {
      zagrodaId: f.zagrodaId,
      turnusId: f.turnusIds[0],
      tripDate: "2026-07-01",
      participants: 10,
      status: "rejected",
    });

    const { row, error } = await accept(f.owner, requestId);

    expect(row).toBeUndefined();
    expect(error?.code).toBe("55000"); // object_not_in_prerequisite_state
  });

  it("(h3) hard error: a nonexistent request id gets an exception", async () => {
    const f = await seedFixture(30);

    const { row, error } = await accept(f.owner, randomUUID());

    expect(row).toBeUndefined();
    expect(error?.code).toBe("P0002"); // no_data_found
  });
});
