import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { APIRoute } from "astro";
import { POST as acceptPost } from "../../src/pages/api/booking-request/accept";
import { POST as rejectPost } from "../../src/pages/api/booking-request/reject";
import { POST as withdrawPost } from "../../src/pages/api/booking-request/withdraw";
import { assertNoContactData, CookieJar, createApiContext, runRoute, signInOwnerHttp } from "../helpers/api";
import {
  createAdminClient,
  createOwnerClient,
  seedBookingRequest,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// Risk #1 at the HTTP layer: the accept/reject/withdraw handlers faithfully
// wire request → atomic RPC → response. RPC internals (lock order, capacity
// math) are proven in tests/db/ — these tests assert the handler neither
// subtracts from the guarantee nor invents its own outcomes, and that the
// refusal copy is the PRD's, not an accident of the implementation.

const PASSWORD = "test-password-123";
const RACE_ITERATIONS = 10;

let admin: TypedClient;

beforeAll(() => {
  admin = createAdminClient();
});

/**
 * PRD-derived capacity oracle — prd.md FR-014 (line 131) fixes the template
 * "Limit dzienny przekroczony (X z Y zajęte, Z wymaga miejsca)" and US-01
 * (line 57) pins the concrete instance "(20 z 30 zajęte, 15 wymaga miejsca)".
 * The expected string is built HERE from the PRD template + this file's own
 * fixture numbers — never imported from or eyeballed against accept.ts.
 */
function prdCapacityMessage(occupied: number, dailyLimit: number, requested: number): string {
  return `Limit dzienny przekroczony (${occupied} z ${dailyLimit} zajęte, ${requested} wymaga miejsca)`;
}

interface GuestContact {
  guestName: string;
  guestEmail: string;
  guestPhone: string;
}

/** Unique contact values per test so outbox rows are attributable and leak assertions meaningful. */
function uniqueGuest(label: string): GuestContact {
  return {
    guestName: `Klasa ${label}`,
    guestEmail: uniqueEmail(`guest-${label}`),
    guestPhone: `+48 6${randomUUID().replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`,
  };
}

interface OwnerFixture {
  email: string;
  zagrodaId: string;
  turnusId: string;
  jar: CookieJar;
}

/** Fresh owner + zagroda + signed-in jar. One per test: zagrody.owner_id is UNIQUE. */
async function createOwnerFixture(dailyLimit = 30): Promise<OwnerFixture> {
  const email = uniqueEmail("decision");
  const { userId } = await createOwnerClient(email, PASSWORD);
  const { zagrodaId, turnusIds } = await seedZagroda(admin, { ownerId: userId, dailyLimit });
  const jar = new CookieJar();
  await signInOwnerHttp(jar, email, PASSWORD);
  return { email, zagrodaId, turnusId: turnusIds[0], jar };
}

function postDecision(handler: APIRoute, route: string, jar: CookieJar, body: unknown): Promise<Response> {
  return runRoute(handler, createApiContext({ jar, path: route, body }));
}

/**
 * Reads the body once, runs the contact-data non-exposure invariant (risk #4
 * holds across ALL suites, not just authz), and returns the parsed JSON.
 */
async function readBody(response: Response, guests: GuestContact[]): Promise<unknown> {
  const text = await response.text();
  for (const guest of guests) {
    assertNoContactData(text, { guest_email: guest.guestEmail, guest_phone: guest.guestPhone });
  }
  return JSON.parse(text) as unknown;
}

async function outboxCountFor(guestEmail: string): Promise<number> {
  const { count, error } = await admin
    .from("email_outbox")
    .select("id", { count: "exact", head: true })
    .eq("to_email", guestEmail);
  expect(error).toBeNull();
  return count ?? 0;
}

async function requestStatus(requestId: string): Promise<string> {
  const { data, error } = await admin.from("booking_requests").select("status").eq("id", requestId).single();
  expect(error).toBeNull();
  if (!data) throw new Error(`request ${requestId} not found`);
  return data.status;
}

interface CapacityRefusal {
  error: string;
  occupied: number;
  daily_limit: number;
  requested: number;
}

describe("booking decision lifecycle — HTTP surface", () => {
  it("accept happy path → 200, DB row accepted, one outbox row to the guest", async () => {
    const fixture = await createOwnerFixture();
    const guest = uniqueGuest("accept");
    const requestId = await seedBookingRequest(admin, {
      zagrodaId: fixture.zagrodaId,
      turnusId: fixture.turnusId,
      tripDate: "2026-07-01",
      participants: 10,
      ...guest,
    });

    const response = await postDecision(acceptPost, "/api/booking-request/accept", fixture.jar, { id: requestId });
    expect(response.status).toBe(200);
    expect(await readBody(response, [guest])).toEqual({ ok: true, status: "accepted" });

    expect(await requestStatus(requestId)).toBe("accepted");
    expect(await outboxCountFor(guest.guestEmail)).toBe(1);
  });

  it("reject happy path → 200, DB row rejected", async () => {
    const fixture = await createOwnerFixture();
    const guest = uniqueGuest("reject");
    const requestId = await seedBookingRequest(admin, {
      zagrodaId: fixture.zagrodaId,
      turnusId: fixture.turnusId,
      tripDate: "2026-07-01",
      participants: 10,
      ...guest,
    });

    const response = await postDecision(rejectPost, "/api/booking-request/reject", fixture.jar, { id: requestId });
    expect(response.status).toBe(200);
    expect(await readBody(response, [guest])).toEqual({ ok: true, status: "rejected" });

    expect(await requestStatus(requestId)).toBe("rejected");
  });

  it("capacity refusal → 409 with the exact PRD FR-014/US-01 message and structured fields", async () => {
    // US-01's own numbers: limit 30, requests of 20 and 15 on the same day.
    const fixture = await createOwnerFixture(30);
    const guestBig = uniqueGuest("cap-big");
    const guestSmall = uniqueGuest("cap-small");
    const tripDate = "2026-07-02";
    const requestBig = await seedBookingRequest(admin, {
      zagrodaId: fixture.zagrodaId,
      turnusId: fixture.turnusId,
      tripDate,
      participants: 20,
      ...guestBig,
    });
    const requestSmall = await seedBookingRequest(admin, {
      zagrodaId: fixture.zagrodaId,
      turnusId: fixture.turnusId,
      tripDate,
      participants: 15,
      ...guestSmall,
    });

    const acceptBig = await postDecision(acceptPost, "/api/booking-request/accept", fixture.jar, { id: requestBig });
    expect(acceptBig.status).toBe(200);
    expect(await readBody(acceptBig, [guestBig, guestSmall])).toEqual({ ok: true, status: "accepted" });

    const acceptSmall = await postDecision(acceptPost, "/api/booking-request/accept", fixture.jar, {
      id: requestSmall,
    });
    expect(acceptSmall.status).toBe(409);
    expect(await readBody(acceptSmall, [guestBig, guestSmall])).toEqual({
      error: prdCapacityMessage(20, 30, 15),
      occupied: 20,
      daily_limit: 30,
      requested: 15,
    });

    // The loser stays pending and triggers no email.
    expect(await requestStatus(requestSmall)).toBe("pending");
    expect(await outboxCountFor(guestSmall.guestEmail)).toBe(0);
  });

  it(
    `parallel accepts → exactly one 200 and one 409 (${RACE_ITERATIONS} iterations)`,
    { timeout: 180_000 },
    async () => {
      // One owner + one zagroda; capacity is computed per zagroda + trip_date,
      // so a fresh date per iteration is an independent arena (zagrody.owner_id
      // is UNIQUE — per-iteration zagrody would need per-iteration owners; two
      // reusable sessions are cheaper). Race mechanics per tests/db/concurrency.test.ts.
      const fixture = await createOwnerFixture(30);
      const jarB = new CookieJar();
      await signInOwnerHttp(jarB, fixture.email, PASSWORD);

      for (let i = 0; i < RACE_ITERATIONS; i++) {
        const tripDate = `2026-08-${String(i + 1).padStart(2, "0")}`;
        const guestBig = uniqueGuest(`race-${i}-big`);
        const guestSmall = uniqueGuest(`race-${i}-small`);
        const requestBig = await seedBookingRequest(admin, {
          zagrodaId: fixture.zagrodaId,
          turnusId: fixture.turnusId,
          tripDate,
          participants: 20,
          ...guestBig,
        });
        const requestSmall = await seedBookingRequest(admin, {
          zagrodaId: fixture.zagrodaId,
          turnusId: fixture.turnusId,
          tripDate,
          participants: 15,
          ...guestSmall,
        });

        const [resBig, resSmall] = await Promise.all([
          postDecision(acceptPost, "/api/booking-request/accept", fixture.jar, { id: requestBig }),
          postDecision(acceptPost, "/api/booking-request/accept", jarB, { id: requestSmall }),
        ]);

        const statuses = [resBig.status, resSmall.status].sort((a, b) => a - b);
        expect(statuses, `iteration ${i}: expected exactly one 200 and one 409`).toEqual([200, 409]);

        const bigWon = resBig.status === 200;
        const winner = bigWon ? { response: resBig, participants: 20 } : { response: resSmall, participants: 15 };
        const loser = bigWon ? { response: resSmall, participants: 15 } : { response: resBig, participants: 20 };

        expect(await readBody(winner.response, [guestBig, guestSmall])).toEqual({ ok: true, status: "accepted" });

        // The 409's structured fields must be internally consistent: the loser
        // observed the winner's seats under the lock, against the same limit.
        const refusal = (await readBody(loser.response, [guestBig, guestSmall])) as CapacityRefusal;
        expect(refusal.occupied, `iteration ${i}: loser must see winner's seats`).toBe(winner.participants);
        expect(refusal.daily_limit, `iteration ${i}`).toBe(30);
        expect(refusal.requested, `iteration ${i}`).toBe(loser.participants);
        expect(refusal.error, `iteration ${i}`).toBe(prdCapacityMessage(winner.participants, 30, loser.participants));

        // End state for this iteration's arena: exactly one accepted row.
        const { data: acceptedRows, error } = await admin
          .from("booking_requests")
          .select("id")
          .eq("zagroda_id", fixture.zagrodaId)
          .eq("trip_date", tripDate)
          .eq("status", "accepted");
        expect(error).toBeNull();
        expect(acceptedRows, `iteration ${i}: exactly one accepted row in DB`).toHaveLength(1);

        console.log(
          `iteration ${String(i + 1).padStart(2)}/${RACE_ITERATIONS}: ` +
            `winner=${winner.participants} seats, loser blocked at occupied=${refusal.occupied}/${refusal.daily_limit}`,
        );
      }
    },
  );

  it("withdraw frees seats: accept 20 → refuse 15 → withdraw → 15 now accepted", async () => {
    const fixture = await createOwnerFixture(30);
    const guestBig = uniqueGuest("wd-big");
    const guestSmall = uniqueGuest("wd-small");
    const tripDate = "2026-07-03";
    const requestBig = await seedBookingRequest(admin, {
      zagrodaId: fixture.zagrodaId,
      turnusId: fixture.turnusId,
      tripDate,
      participants: 20,
      ...guestBig,
    });
    const requestSmall = await seedBookingRequest(admin, {
      zagrodaId: fixture.zagrodaId,
      turnusId: fixture.turnusId,
      tripDate,
      participants: 15,
      ...guestSmall,
    });

    const acceptBig = await postDecision(acceptPost, "/api/booking-request/accept", fixture.jar, { id: requestBig });
    expect(acceptBig.status).toBe(200);
    void (await readBody(acceptBig, [guestBig, guestSmall]));

    const refused = await postDecision(acceptPost, "/api/booking-request/accept", fixture.jar, { id: requestSmall });
    expect(refused.status).toBe(409);
    void (await readBody(refused, [guestBig, guestSmall]));

    const withdraw = await postDecision(withdrawPost, "/api/booking-request/withdraw", fixture.jar, {
      id: requestBig,
    });
    expect(withdraw.status).toBe(200);
    expect(await readBody(withdraw, [guestBig, guestSmall])).toEqual({ ok: true, status: "withdrawn_by_owner" });
    expect(await requestStatus(requestBig)).toBe("withdrawn_by_owner");
    // FR-016: the withdrawal notifies the guest — acceptance + withdrawal rows.
    expect(await outboxCountFor(guestBig.guestEmail)).toBe(2);

    // FR-016/US-01: freed seats are immediately acceptable.
    const acceptSmall = await postDecision(acceptPost, "/api/booking-request/accept", fixture.jar, {
      id: requestSmall,
    });
    expect(acceptSmall.status).toBe(200);
    expect(await readBody(acceptSmall, [guestBig, guestSmall])).toEqual({ ok: true, status: "accepted" });
    expect(await requestStatus(requestSmall)).toBe("accepted");
  });

  it("withdraw of a pending request → 409 with the current status", async () => {
    const fixture = await createOwnerFixture();
    const guest = uniqueGuest("wd-pending");
    const requestId = await seedBookingRequest(admin, {
      zagrodaId: fixture.zagrodaId,
      turnusId: fixture.turnusId,
      tripDate: "2026-07-04",
      participants: 10,
      ...guest,
    });

    const response = await postDecision(withdrawPost, "/api/booking-request/withdraw", fixture.jar, {
      id: requestId,
    });
    expect(response.status).toBe(409);
    expect(await readBody(response, [guest])).toEqual({
      error: "To zapytanie nie jest już zaakceptowane — odśwież stronę",
      status: "pending",
    });
    expect(await requestStatus(requestId)).toBe("pending");
  });

  describe("error translation on accept", () => {
    let fixture: OwnerFixture;
    let guest: GuestContact;
    let rejectedRequestId: string;

    beforeAll(async () => {
      fixture = await createOwnerFixture();
      guest = uniqueGuest("err");
      rejectedRequestId = await seedBookingRequest(admin, {
        zagrodaId: fixture.zagrodaId,
        turnusId: fixture.turnusId,
        tripDate: "2026-07-05",
        participants: 10,
        status: "rejected",
        ...guest,
      });
    });

    it("nonexistent UUID → 404", async () => {
      const response = await postDecision(acceptPost, "/api/booking-request/accept", fixture.jar, {
        id: randomUUID(),
      });
      expect(response.status).toBe(404);
      expect(await readBody(response, [guest])).toEqual({ error: "Zapytanie nie istnieje" });
    });

    it("non-pending request → 409", async () => {
      const response = await postDecision(acceptPost, "/api/booking-request/accept", fixture.jar, {
        id: rejectedRequestId,
      });
      expect(response.status).toBe(409);
      expect(await readBody(response, [guest])).toEqual({
        error: "To zapytanie nie jest już oczekujące — odśwież stronę",
      });
      expect(await requestStatus(rejectedRequestId)).toBe("rejected");
    });

    it("non-UUID id → 422 (schema parse)", async () => {
      const response = await postDecision(acceptPost, "/api/booking-request/accept", fixture.jar, {
        id: "not-a-uuid",
      });
      expect(response.status).toBe(422);
      expect(await readBody(response, [guest])).toEqual({ error: "Nieprawidłowe dane żądania" });
    });

    it("non-JSON body → 400", async () => {
      // Raw string passes through createApiContext unstringified — a malformed body.
      const response = await postDecision(acceptPost, "/api/booking-request/accept", fixture.jar, "to nie json{{");
      expect(response.status).toBe(400);
      expect(await readBody(response, [guest])).toEqual({ error: "Nieprawidłowe dane żądania" });
    });
  });
});
