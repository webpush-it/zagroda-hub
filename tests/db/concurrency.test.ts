import { beforeAll, describe, expect, it } from "vitest";
import {
  createAdminClient,
  createOwnerClient,
  createSignedInClient,
  seedBookingRequest,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// Proof of "exactly one success" — PRD success criterion #1 (US-01).
// A single run of two parallel rpc() calls can pass by luck without a real
// collision, so the race is iterated: every iteration gets a fresh zagroda
// (limit 30) and two pending requests (20 and 15 people) for the same day.
// 20 + 15 > 30, so by the rule exactly one of the two calls may ever succeed.

const ITERATIONS = 20;
const PASSWORD = "test-password-123";

let admin: TypedClient;

beforeAll(() => {
  admin = createAdminClient();
});

describe("accept_booking_request — concurrency", () => {
  it(`exactly one of two parallel acceptances succeeds (${ITERATIONS} iterations)`, { timeout: 300_000 }, async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      // Fresh zagroda needs a fresh owner: owner_id is UNIQUE on zagrody.
      const email = uniqueEmail(`race-${i}`);
      const { client: ownerA, userId } = await createOwnerClient(email, PASSWORD);
      // Two independent signed-in clients of the same owner.
      const ownerB = await createSignedInClient(email, PASSWORD);
      const { zagrodaId, turnusIds } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });

      const tripDate = "2026-07-01";
      const requestBig = await seedBookingRequest(admin, {
        zagrodaId,
        turnusId: turnusIds[0],
        tripDate,
        participants: 20,
      });
      const requestSmall = await seedBookingRequest(admin, {
        zagrodaId,
        turnusId: turnusIds[0],
        tripDate,
        participants: 15,
      });

      const [resBig, resSmall] = await Promise.all([
        ownerA.rpc("accept_booking_request", { request_id: requestBig }),
        ownerB.rpc("accept_booking_request", { request_id: requestSmall }),
      ]);

      expect(resBig.error, `iteration ${i}: big request errored`).toBeNull();
      expect(resSmall.error, `iteration ${i}: small request errored`).toBeNull();

      const rowBig = resBig.data?.[0];
      const rowSmall = resSmall.data?.[0];
      if (!rowBig || !rowSmall) throw new Error(`iteration ${i}: missing result row`);

      // Exactly one success.
      const successes = [rowBig, rowSmall].filter((r) => r.accepted);
      expect(successes, `iteration ${i}: expected exactly one success`).toHaveLength(1);

      // The loser observed the winner's seats under the lock.
      const winner = rowBig.accepted ? rowBig : rowSmall;
      const loser = rowBig.accepted ? rowSmall : rowBig;
      expect(loser.occupied, `iteration ${i}: loser must see winner's seats`).toBe(winner.requested);
      expect(winner.occupied, `iteration ${i}: winner saw an empty day`).toBe(0);

      // End state in the database: exactly one accepted request.
      const { data: acceptedRows, error } = await admin
        .from("booking_requests")
        .select("id, participants_count")
        .eq("zagroda_id", zagrodaId)
        .eq("status", "accepted");
      expect(error).toBeNull();
      expect(acceptedRows, `iteration ${i}: exactly one accepted row in DB`).toHaveLength(1);

      console.log(
        `iteration ${String(i + 1).padStart(2)}/${ITERATIONS}: ` +
          `winner=${winner.requested} seats, loser blocked at occupied=${loser.occupied}/${loser.daily_limit}`,
      );
    }
  });
});
