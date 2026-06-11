import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createAdminClient,
  createAnonClient,
  createOwnerClient,
  createSignedInClient,
  seedBookingRequest,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// S-05 owner withdraw primitive. withdraw_booking_request is the only
// accepted -> withdrawn_by_owner transition (authenticated-only SECURITY
// DEFINER; no UPDATE policy). Ownership is checked before any state-dependent
// return, non-accepted states are soft outcomes (mirroring
// reject_booking_request), and the immutable lock-order columns are never
// touched. The US-01 capacity-release proof lives in acceptance-rule.test.ts
// case (d) — here we prove semantics and race safety.

const PASSWORD = "test-password-123";

let admin: TypedClient;
let owner: TypedClient;
let ownerId: string;
let zagrodaId: string;
let turnusId: string;

beforeAll(async () => {
  admin = createAdminClient();
  const created = await createOwnerClient(uniqueEmail("withdraw-owner"), PASSWORD);
  owner = created.client;
  ownerId = created.userId;
  const seeded = await seedZagroda(admin, { ownerId, dailyLimit: 30 });
  zagrodaId = seeded.zagrodaId;
  turnusId = seeded.turnusIds[0];
});

async function withdraw(client: TypedClient, requestId: string) {
  const { data, error } = await client.rpc("withdraw_booking_request", { request_id: requestId });
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

describe("withdraw_booking_request — owner withdraw", () => {
  it("(a) owner withdraws an accepted request; immutable columns untouched", async () => {
    const id = await seedBookingRequest(admin, {
      zagrodaId,
      turnusId,
      tripDate: "2026-09-01",
      participants: 5,
      status: "accepted",
    });
    const before = await rowOf(id);

    const { row, error } = await withdraw(owner, id);

    expect(error).toBeNull();
    expect(row).toMatchObject({ withdrawn: true, status: "withdrawn_by_owner" });
    const after = await rowOf(id);
    expect(after).toMatchObject({
      status: "withdrawn_by_owner",
      zagroda_id: before.zagroda_id,
      turnus_id: before.turnus_id,
      trip_date: before.trip_date,
    });
  });

  it("(b) non-accepted states are soft outcomes; row left unchanged (incl. idempotent re-withdraw)", async () => {
    for (const status of ["pending", "rejected", "cancelled_by_guest", "withdrawn_by_owner"] as const) {
      const id = await seedBookingRequest(admin, {
        zagrodaId,
        turnusId,
        tripDate: "2026-09-02",
        participants: 5,
        status,
      });

      const { row, error } = await withdraw(owner, id);

      expect(error).toBeNull();
      expect(row).toMatchObject({ withdrawn: false, status });
      await expect(rowOf(id).then((r) => r.status)).resolves.toBe(status);
    }
  });

  it("(c) a non-owner authenticated caller gets 42501 regardless of state", async () => {
    const id = await seedBookingRequest(admin, {
      zagrodaId,
      turnusId,
      tripDate: "2026-09-03",
      participants: 5,
      status: "accepted",
    });
    const { client: stranger } = await createOwnerClient(uniqueEmail("withdraw-stranger"), PASSWORD);

    const { row, error } = await withdraw(stranger, id);

    expect(row).toBeUndefined();
    expect(error?.code).toBe("42501"); // insufficient_privilege
    await expect(rowOf(id).then((r) => r.status)).resolves.toBe("accepted");
  });

  it("(d) an unknown request id raises P0002", async () => {
    const { row, error } = await withdraw(owner, randomUUID());

    expect(row).toBeUndefined();
    expect(error?.code).toBe("P0002"); // no_data_found
  });

  it("(e) anon has no EXECUTE grant", async () => {
    const id = await seedBookingRequest(admin, {
      zagrodaId,
      turnusId,
      tripDate: "2026-09-04",
      participants: 5,
      status: "accepted",
    });
    const anon = createAnonClient();

    const { row, error } = await withdraw(anon, id);

    expect(row).toBeUndefined();
    expect(error?.code).toBe("42501"); // permission denied for function
    await expect(rowOf(id).then((r) => r.status)).resolves.toBe("accepted");
  });
});

describe("withdraw_booking_request — concurrency", () => {
  const ITERATIONS = 20;

  it(
    `withdraw racing accept-of-another-request never breaks the daily limit (${ITERATIONS} iterations)`,
    { timeout: 300_000 },
    async () => {
      // Accepted A (25/30) + pending B (15). withdraw(A) races accept(B):
      // either accept reads occupancy before the withdrawal commits and is
      // conservatively blocked (B stays pending), or it reads after and
      // succeeds. In BOTH outcomes the invariant holds: sum of accepted
      // participants on the day never exceeds daily_limit, and the
      // withdrawal itself always succeeds.
      for (let i = 0; i < ITERATIONS; i++) {
        const email = uniqueEmail(`withdraw-race-${i}`);
        const { client: ownerA, userId } = await createOwnerClient(email, PASSWORD);
        const ownerB = await createSignedInClient(email, PASSWORD);
        const seeded = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });

        const tripDate = "2026-09-10";
        const acceptedA = await seedBookingRequest(admin, {
          zagrodaId: seeded.zagrodaId,
          turnusId: seeded.turnusIds[0],
          tripDate,
          participants: 25,
          status: "accepted",
        });
        const pendingB = await seedBookingRequest(admin, {
          zagrodaId: seeded.zagrodaId,
          turnusId: seeded.turnusIds[0],
          tripDate,
          participants: 15,
        });

        const [resWithdraw, resAccept] = await Promise.all([
          ownerA.rpc("withdraw_booking_request", { request_id: acceptedA }),
          ownerB.rpc("accept_booking_request", { request_id: pendingB }),
        ]);

        expect(resWithdraw.error, `iteration ${i}: withdraw errored`).toBeNull();
        expect(resAccept.error, `iteration ${i}: accept errored`).toBeNull();

        const withdrawRow = resWithdraw.data?.[0];
        const acceptRow = resAccept.data?.[0];
        if (!withdrawRow || !acceptRow) throw new Error(`iteration ${i}: missing result row`);

        // The withdrawal always succeeds (A was accepted; nothing else touches it).
        expect(withdrawRow, `iteration ${i}: withdraw must win`).toMatchObject({
          withdrawn: true,
          status: "withdrawn_by_owner",
        });

        // Invariant: the day's accepted sum never exceeds the limit.
        const { data: acceptedRows, error } = await admin
          .from("booking_requests")
          .select("participants_count")
          .eq("zagroda_id", seeded.zagrodaId)
          .eq("trip_date", tripDate)
          .eq("status", "accepted");
        expect(error).toBeNull();
        const sum = (acceptedRows ?? []).reduce((acc, r) => acc + r.participants_count, 0);
        expect(sum, `iteration ${i}: accepted sum exceeds the daily limit`).toBeLessThanOrEqual(30);

        // B's outcome is interleaving-dependent but must be consistent:
        // accepted=true -> B is the only accepted row; accepted=false ->
        // conservative block, B still pending with the pre-withdraw numbers.
        if (acceptRow.accepted) {
          expect(sum, `iteration ${i}: only B should occupy the day`).toBe(15);
        } else {
          expect(acceptRow, `iteration ${i}: conservative block saw stale occupancy`).toMatchObject({
            occupied: 25,
            daily_limit: 30,
            requested: 15,
          });
          expect(sum, `iteration ${i}: day should be empty after withdrawal`).toBe(0);
        }
      }
    },
  );

  it(
    "withdraw racing reject on the same request: withdraw wins, reject is a soft outcome (10 iterations)",
    { timeout: 300_000 },
    async () => {
      // Both functions lock the same request row, so they serialize. The
      // request is accepted: reject is only legal from pending, so whatever
      // the interleaving, the withdrawal succeeds and the reject resolves to
      // a soft outcome (rejected=false) — exactly one mutator changes the row.
      for (let i = 0; i < 10; i++) {
        const email = uniqueEmail(`withdraw-reject-race-${i}`);
        const { client: ownerA, userId } = await createOwnerClient(email, PASSWORD);
        const ownerB = await createSignedInClient(email, PASSWORD);
        const seeded = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });

        const id = await seedBookingRequest(admin, {
          zagrodaId: seeded.zagrodaId,
          turnusId: seeded.turnusIds[0],
          tripDate: "2026-09-11",
          participants: 5,
          status: "accepted",
        });

        const [resWithdraw, resReject] = await Promise.all([
          ownerA.rpc("withdraw_booking_request", { request_id: id }),
          ownerB.rpc("reject_booking_request", { request_id: id }),
        ]);

        expect(resWithdraw.error, `iteration ${i}: withdraw errored`).toBeNull();
        expect(resReject.error, `iteration ${i}: reject errored`).toBeNull();

        expect(resWithdraw.data?.[0], `iteration ${i}: withdraw must win`).toMatchObject({
          withdrawn: true,
          status: "withdrawn_by_owner",
        });
        expect(resReject.data?.[0]?.rejected, `iteration ${i}: reject must be soft`).toBe(false);

        const { data: finalRow, error } = await admin.from("booking_requests").select("status").eq("id", id).single();
        expect(error).toBeNull();
        expect(finalRow?.status, `iteration ${i}: final state`).toBe("withdrawn_by_owner");
      }
    },
  );
});
