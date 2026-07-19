import { beforeAll, describe, expect, it } from "vitest";
import type { APIRoute } from "astro";
import { POST as manualPost } from "../../src/pages/api/manual-booking/index";
import { POST as dayBlockPost, DELETE as dayBlockDelete } from "../../src/pages/api/day-block/index";
import { POST as acceptPost } from "../../src/pages/api/booking-request/accept";
import { POST as withdrawPost } from "../../src/pages/api/booking-request/withdraw";
import { assertNoContactData, CookieJar, createApiContext, runRoute, signInOwnerHttp } from "../helpers/api";
import {
  clearEmailConfirmation,
  createAdminClient,
  createOwnerClient,
  seedBookingRequest,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// S-08 at the HTTP layer: the manual-booking and day-block routes faithfully
// wire owner input → SECURITY DEFINER RPC → response. Lock order, capacity
// math and block semantics are proven in tests/db/ (manual-bookings,
// day-blocks, concurrency) — these tests assert the auth gates, the zod parse,
// the pgcode translation and the soft-409 contracts (FR-014 copy, day_blocked
// code), plus the no-email guarantee on phone-entry removal.

const PASSWORD = "test-password-123";

let admin: TypedClient;

beforeAll(() => {
  admin = createAdminClient();
});

/**
 * PRD-derived capacity oracle — same FR-014 template as
 * tests/api/booking-decision.test.ts, built from this file's own fixture
 * numbers, never imported from the routes under test.
 */
function prdCapacityMessage(occupied: number, dailyLimit: number, requested: number): string {
  return `Limit dzienny przekroczony (${occupied} z ${dailyLimit} zajęte, ${requested} wymaga miejsca)`;
}

interface OwnerFixture {
  email: string;
  zagrodaId: string;
  turnusId: string;
  jar: CookieJar;
}

/** Fresh owner + zagroda + signed-in jar. One per test: zagrody.owner_id is UNIQUE. */
async function createOwnerFixture(dailyLimit = 30): Promise<OwnerFixture> {
  const email = uniqueEmail("manual");
  const { userId } = await createOwnerClient(email, PASSWORD);
  const { zagrodaId, turnusIds } = await seedZagroda(admin, { ownerId: userId, dailyLimit });
  const jar = new CookieJar();
  await signInOwnerHttp(jar, email, PASSWORD);
  return { email, zagrodaId, turnusId: turnusIds[0], jar };
}

function post(handler: APIRoute, path: string, jar: CookieJar, body: unknown, method = "POST"): Promise<Response> {
  return runRoute(handler, createApiContext({ jar, method, path, body }));
}

function postManual(jar: CookieJar, body: unknown): Promise<Response> {
  return post(manualPost, "/api/manual-booking", jar, body);
}

function postBlock(jar: CookieJar, body: unknown): Promise<Response> {
  return post(dayBlockPost, "/api/day-block", jar, body);
}

function deleteBlock(jar: CookieJar, body: unknown): Promise<Response> {
  return post(dayBlockDelete, "/api/day-block", jar, body, "DELETE");
}

/** A valid manual-entry payload against the fixture; override exactly the attacked field. */
function manualPayload(fixture: OwnerFixture, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    zagroda_id: fixture.zagrodaId,
    turnus_id: fixture.turnusId,
    trip_date: "2026-10-01",
    participants_count: 10,
    ...overrides,
  };
}

describe("POST /api/manual-booking — phone entries (S-08)", () => {
  it("happy path → 200 {ok, id}; row accepted, source phone, no guest contact, note stored", async () => {
    const fixture = await createOwnerFixture();
    const response = await postManual(fixture.jar, manualPayload(fixture, { note: "Pani Kowalska, SP 12" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();

    const { data, error } = await admin
      .from("booking_requests")
      .select("status, source, note, guest_name, guest_email, guest_phone, participants_count")
      .eq("id", body.id)
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({
      status: "accepted",
      source: "phone",
      note: "Pani Kowalska, SP 12",
      guest_name: null,
      guest_email: null,
      guest_phone: null,
      participants_count: 10,
    });
  });

  it("anonymous → 401", async () => {
    const fixture = await createOwnerFixture();
    const response = await postManual(new CookieJar(), manualPayload(fixture));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Zaloguj się, aby zarządzać rezerwacjami" });
  });

  it("unverified owner → 409 verification gate", async () => {
    const email = uniqueEmail("manual-unverified");
    const { userId } = await createOwnerClient(email, PASSWORD);
    const { zagrodaId, turnusIds } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });
    const jar = new CookieJar();
    await signInOwnerHttp(jar, email, PASSWORD);
    await clearEmailConfirmation(userId);

    const response = await postManual(jar, {
      zagroda_id: zagrodaId,
      turnus_id: turnusIds[0],
      trip_date: "2026-10-01",
      participants_count: 10,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Zweryfikuj adres e-mail, aby zarządzać rezerwacjami" });
  });

  it("foreign owner posting the victim's zagroda_id → 403 (RPC 42501), no entry created", async () => {
    const victim = await createOwnerFixture();
    const attacker = await createOwnerFixture();

    const response = await postManual(attacker.jar, manualPayload(victim));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Brak uprawnień do tej zagrody" });

    const { count } = await admin
      .from("booking_requests")
      .select("id", { count: "exact", head: true })
      .eq("zagroda_id", victim.zagrodaId);
    expect(count).toBe(0);
  });

  // Server-side parse parity with manualBookingSchema — assert status + the
  // offending fieldErrors key, not the copy (copy snapshots pin wording).
  const INVALID_FIELD_CASES = [
    { label: "trip_date in the past", overrides: { trip_date: "2020-01-01" }, key: "trip_date" },
    { label: "zero participants", overrides: { participants_count: 0 }, key: "participants_count" },
    { label: "note over 500 chars", overrides: { note: "x".repeat(501) }, key: "note" },
  ] as const;

  it.each(INVALID_FIELD_CASES)("$label → 422 with fieldErrors.$key", async ({ overrides, key }) => {
    const fixture = await createOwnerFixture();
    const response = await postManual(fixture.jar, manualPayload(fixture, overrides));
    expect(response.status).toBe(422);
    const parsed = (await response.json()) as { error: string; fieldErrors?: Record<string, unknown> };
    expect(parsed.error).toBe("Sprawdź poprawność formularza");
    expect(parsed.fieldErrors).toHaveProperty(key);
  });

  it("non-JSON body → 400", async () => {
    const fixture = await createOwnerFixture();
    const response = await postManual(fixture.jar, "to nie json{{");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Nieprawidłowe dane żądania" });
  });

  it("US-03/FR-028: manual 20/30 consumes capacity → accepting a pending 15 → 409 with the exact FR-014 copy", async () => {
    const fixture = await createOwnerFixture(30);
    const tripDate = "2026-10-02";
    const guest = {
      guestName: "Klasa manual-cap",
      guestEmail: uniqueEmail("guest-manual-cap"),
      guestPhone: "+48 600 111 222",
    };
    const pendingId = await seedBookingRequest(admin, {
      zagrodaId: fixture.zagrodaId,
      turnusId: fixture.turnusId,
      tripDate,
      participants: 15,
      ...guest,
    });

    const manual = await postManual(
      fixture.jar,
      manualPayload(fixture, { trip_date: tripDate, participants_count: 20 }),
    );
    expect(manual.status).toBe(200);

    const accept = await post(acceptPost, "/api/booking-request/accept", fixture.jar, { id: pendingId });
    expect(accept.status).toBe(409);
    const text = await accept.text();
    assertNoContactData(text, { guest_email: guest.guestEmail, guest_phone: guest.guestPhone });
    expect(JSON.parse(text)).toEqual({
      error: prdCapacityMessage(20, 30, 15),
      occupied: 20,
      daily_limit: 30,
      requested: 15,
    });
  });

  it("over-limit manual entry → 409 with the exact FR-014 copy and structured fields, no row created", async () => {
    const fixture = await createOwnerFixture(30);
    const tripDate = "2026-10-03";
    const first = await postManual(
      fixture.jar,
      manualPayload(fixture, { trip_date: tripDate, participants_count: 20 }),
    );
    expect(first.status).toBe(200);

    const second = await postManual(
      fixture.jar,
      manualPayload(fixture, { trip_date: tripDate, participants_count: 15 }),
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: prdCapacityMessage(20, 30, 15),
      occupied: 20,
      daily_limit: 30,
      requested: 15,
    });

    const { count } = await admin
      .from("booking_requests")
      .select("id", { count: "exact", head: true })
      .eq("zagroda_id", fixture.zagrodaId)
      .eq("trip_date", tripDate);
    expect(count).toBe(1);
  });

  it("manual entry on a blocked day → 409 { code: 'day_blocked' }", async () => {
    const fixture = await createOwnerFixture();
    const tripDate = "2026-10-04";
    const block = await postBlock(fixture.jar, { zagroda_id: fixture.zagrodaId, blocked_date: tripDate });
    expect(block.status).toBe(200);

    const response = await postManual(fixture.jar, manualPayload(fixture, { trip_date: tripDate }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "day_blocked",
      error: "Dzień jest zablokowany — odblokuj go, aby dodać rezerwację",
    });
  });

  it("phone-entry removal via withdraw → 200 with notified:false and NO outbox row (no guest e-mail)", async () => {
    const fixture = await createOwnerFixture();
    const created = await postManual(fixture.jar, manualPayload(fixture, { trip_date: "2026-10-05" }));
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };

    const outboxBefore = await admin.from("email_outbox").select("id", { count: "exact", head: true });
    const withdraw = await post(withdrawPost, "/api/booking-request/withdraw", fixture.jar, { id });
    expect(withdraw.status).toBe(200);
    // notified:false is the contract: the e-mail block was skipped entirely —
    // a phone entry has no guest contact, so nothing may reach the outbox.
    expect(await withdraw.json()).toEqual({ ok: true, status: "withdrawn_by_owner", notified: false });

    const { data, error } = await admin.from("booking_requests").select("status").eq("id", id).single();
    expect(error).toBeNull();
    expect(data?.status).toBe("withdrawn_by_owner");

    const outboxAfter = await admin.from("email_outbox").select("id", { count: "exact", head: true });
    expect(outboxAfter.count).toBe(outboxBefore.count);
  });
});

describe("POST/DELETE /api/day-block — day blocks (S-08)", () => {
  it("block → 200; re-block idempotent → 200; unblock → 200; re-unblock → 404", async () => {
    const fixture = await createOwnerFixture();
    const body = { zagroda_id: fixture.zagrodaId, blocked_date: "2026-11-01" };

    const block = await postBlock(fixture.jar, body);
    expect(block.status).toBe(200);
    expect(await block.json()).toEqual({ ok: true });

    const { count } = await admin
      .from("day_blocks")
      .select("id", { count: "exact", head: true })
      .eq("zagroda_id", fixture.zagrodaId)
      .eq("blocked_date", "2026-11-01");
    expect(count).toBe(1);

    const reblock = await postBlock(fixture.jar, body);
    expect(reblock.status).toBe(200);
    expect(await reblock.json()).toEqual({ ok: true });

    const unblock = await deleteBlock(fixture.jar, body);
    expect(unblock.status).toBe(200);
    expect(await unblock.json()).toEqual({ ok: true });

    const reunblock = await deleteBlock(fixture.jar, body);
    expect(reunblock.status).toBe(404);
    expect(await reunblock.json()).toEqual({ error: "Ten dzień nie jest zablokowany" });
  });

  it("anonymous → 401 on both methods", async () => {
    const body = { zagroda_id: "00000000-0000-0000-0000-000000000000", blocked_date: "2026-11-02" };
    const block = await postBlock(new CookieJar(), body);
    expect(block.status).toBe(401);
    expect(await block.json()).toEqual({ error: "Zaloguj się, aby zarządzać dostępnością" });

    const unblock = await deleteBlock(new CookieJar(), body);
    expect(unblock.status).toBe(401);
    expect(await unblock.json()).toEqual({ error: "Zaloguj się, aby zarządzać dostępnością" });
  });

  it("unverified owner → 409 verification gate", async () => {
    const email = uniqueEmail("block-unverified");
    const { userId } = await createOwnerClient(email, PASSWORD);
    const { zagrodaId } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });
    const jar = new CookieJar();
    await signInOwnerHttp(jar, email, PASSWORD);
    await clearEmailConfirmation(userId);

    const response = await postBlock(jar, { zagroda_id: zagrodaId, blocked_date: "2026-11-03" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Zweryfikuj adres e-mail, aby zarządzać dostępnością" });
  });

  it("foreign owner blocking the victim's day → 403 (RPC 42501), no block created", async () => {
    const victim = await createOwnerFixture();
    const attacker = await createOwnerFixture();

    const response = await postBlock(attacker.jar, { zagroda_id: victim.zagrodaId, blocked_date: "2026-11-04" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Brak uprawnień do tej zagrody" });

    const { count } = await admin
      .from("day_blocks")
      .select("id", { count: "exact", head: true })
      .eq("zagroda_id", victim.zagrodaId);
    expect(count).toBe(0);
  });

  it("past blocked_date → 422 (zod, shared schema)", async () => {
    const fixture = await createOwnerFixture();
    const response = await postBlock(fixture.jar, { zagroda_id: fixture.zagrodaId, blocked_date: "2020-01-01" });
    expect(response.status).toBe(422);
    const parsed = (await response.json()) as { fieldErrors?: Record<string, unknown> };
    expect(parsed.fieldErrors).toHaveProperty("blocked_date");
  });
});
