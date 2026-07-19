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

describe("create_manual_booking × accept_booking_request — cross-channel concurrency", () => {
  // S-08 / FR-028: the same "exactly one success" proof for the manual-entry
  // mix. A phone entry (20) races the acceptance of a pending app request (15)
  // on limit 30 — both write paths serialize on the same zagroda FOR UPDATE
  // lock, so exactly one may ever win.
  it(
    `exactly one of a manual entry and a parallel acceptance succeeds (${ITERATIONS} iterations)`,
    { timeout: 300_000 },
    async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const email = uniqueEmail(`manual-race-${i}`);
        const { client: ownerA, userId } = await createOwnerClient(email, PASSWORD);
        const ownerB = await createSignedInClient(email, PASSWORD);
        const { zagrodaId, turnusIds } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });

        // Must be in the future: create_manual_booking hard-rejects past dates.
        const tripDate = "2026-12-01";
        const pendingApp = await seedBookingRequest(admin, {
          zagrodaId,
          turnusId: turnusIds[0],
          tripDate,
          participants: 15,
        });

        const [resManual, resAccept] = await Promise.all([
          ownerA.rpc("create_manual_booking", {
            p_zagroda_id: zagrodaId,
            p_turnus_id: turnusIds[0],
            p_trip_date: tripDate,
            p_participants: 20,
          }),
          ownerB.rpc("accept_booking_request", { request_id: pendingApp }),
        ]);

        expect(resManual.error, `iteration ${i}: manual entry errored`).toBeNull();
        expect(resAccept.error, `iteration ${i}: accept errored`).toBeNull();

        const manualRow = resManual.data?.[0];
        const acceptRow = resAccept.data?.[0];
        if (!manualRow || !acceptRow) throw new Error(`iteration ${i}: missing result row`);

        // Exactly one success across the two channels.
        const successes = [manualRow.created, acceptRow.accepted].filter(Boolean);
        expect(successes, `iteration ${i}: expected exactly one success`).toHaveLength(1);

        // The loser observed the winner's seats under the lock.
        const winner = manualRow.created ? manualRow : acceptRow;
        const loser = manualRow.created ? acceptRow : manualRow;
        expect(loser.occupied, `iteration ${i}: loser must see winner's seats`).toBe(winner.requested);
        expect(winner.occupied, `iteration ${i}: winner saw an empty day`).toBe(0);

        // End state: one phone row + still-pending app request XOR one accepted app row.
        const { data: rows, error } = await admin
          .from("booking_requests")
          .select("status, source, participants_count")
          .eq("zagroda_id", zagrodaId);
        expect(error).toBeNull();
        const acceptedRows = (rows ?? []).filter((r) => r.status === "accepted");
        expect(acceptedRows, `iteration ${i}: exactly one accepted row in DB`).toHaveLength(1);
        if (manualRow.created) {
          expect(acceptedRows[0], `iteration ${i}: winner must be the phone entry`).toMatchObject({
            source: "phone",
            participants_count: 20,
          });
          expect(
            (rows ?? []).filter((r) => r.status === "pending"),
            `iteration ${i}: app request must stay pending`,
          ).toHaveLength(1);
        } else {
          expect(acceptedRows[0], `iteration ${i}: winner must be the app request`).toMatchObject({
            source: "app",
            participants_count: 15,
          });
          expect(
            (rows ?? []).filter((r) => r.source === "phone"),
            `iteration ${i}: no phone row may exist when the entry lost`,
          ).toHaveLength(0);
        }

        console.log(
          `iteration ${String(i + 1).padStart(2)}/${ITERATIONS}: ` +
            `winner=${manualRow.created ? "phone(20)" : "app(15)"}, ` +
            `loser blocked at occupied=${loser.occupied}/${loser.daily_limit}`,
        );
      }
    },
  );
});
