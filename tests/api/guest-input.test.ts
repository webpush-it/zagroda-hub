import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as bookingPost } from "../../src/pages/api/booking-request/index";
import { POST as cancelPost } from "../../src/pages/api/booking-request/cancel";
import { assertNoContactData, createApiContext, runRoute } from "../helpers/api";
import {
  createAdminClient,
  createOwnerClient,
  seedBookingRequest,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// Risk #5 at the HTTP layer: the two UNAUTHENTICATED guest surfaces under
// attack. POST /api/booking-request must run the shared zod parse server-side
// (a refactor that drops it would let hostile payloads through), reject the
// published-only / turnus-on-this-zagroda invariants, and never echo stored
// contact data. POST /api/booking-request/cancel must grant the token exactly
// one capability — cancelling its OWN pending request — and leak no existence
// signal for unknown/non-uuid tokens.
//
// Oracle independence: the hostile payloads below are hand-written, NOT derived
// from bookingRequestSchema. The schema is the thing under test; mirroring it
// here would only prove the test agrees with itself. RPC semantics (lock,
// pending-only transition) are owned by tests/db/guest-cancel.test.ts and are
// NOT re-tested — these assert the handler faithfully wires request → RPC.

const PASSWORD = "test-password-123";

let admin: TypedClient;

beforeAll(() => {
  admin = createAdminClient();
});

interface GuestContact {
  guestName: string;
  guestEmail: string;
  guestPhone: string;
}

/** Unique contact values per test so a leak would be unambiguous and outbox rows attributable. */
function uniqueGuest(label: string): GuestContact {
  return {
    guestName: `Klasa ${label}`,
    guestEmail: uniqueEmail(`guest-${label}`),
    guestPhone: `+48 5${randomUUID().replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`,
  };
}

interface PublishedZagroda {
  ownerEmail: string;
  zagrodaId: string;
  turnusId: string;
}

/** A confirmed owner + a published zagroda with one turnus — the only fixture the create surface accepts. */
async function seedPublishedZagroda(label: string): Promise<PublishedZagroda> {
  const ownerEmail = uniqueEmail(label);
  const { userId } = await createOwnerClient(ownerEmail, PASSWORD);
  const { zagrodaId, turnusIds } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30, published: true });
  return { ownerEmail, zagrodaId, turnusId: turnusIds[0] };
}

function postCreate(body: unknown): Promise<Response> {
  return runRoute(bookingPost, createApiContext({ path: "/api/booking-request", body }));
}

function postCancel(body: unknown): Promise<Response> {
  return runRoute(cancelPost, createApiContext({ path: "/api/booking-request/cancel", body }));
}

/**
 * Reads the body once, enforces the contact-data non-exposure invariant (risk
 * #4 holds across ALL suites, not just authz), and returns the parsed JSON.
 * `guests` are the contact values in scope for this response.
 */
async function readJson(response: Response, guests: GuestContact[]): Promise<unknown> {
  const text = await response.text();
  for (const guest of guests) {
    assertNoContactData(text, { guest_email: guest.guestEmail, guest_phone: guest.guestPhone });
  }
  return JSON.parse(text) as unknown;
}

async function outboxCountFor(toEmail: string): Promise<number> {
  const { count, error } = await admin
    .from("email_outbox")
    .select("id", { count: "exact", head: true })
    .eq("to_email", toEmail);
  expect(error).toBeNull();
  return count ?? 0;
}

describe("POST /api/booking-request — hostile guest input (risk #5)", () => {
  let zagroda: PublishedZagroda;
  let foreign: PublishedZagroda;

  beforeAll(async () => {
    zagroda = await seedPublishedZagroda("create-target");
    // A second published zagroda whose turnus is used to attack the first.
    foreign = await seedPublishedZagroda("create-foreign");
  });

  /** A fully valid guest payload against `zagroda`; override exactly the field a test attacks. */
  function validPayload(guest: GuestContact, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      zagroda_id: zagroda.zagrodaId,
      turnus_id: zagroda.turnusId,
      trip_date: "2026-09-01",
      participants_count: 10,
      guest_name: guest.guestName,
      guest_email: guest.guestEmail,
      guest_phone: guest.guestPhone,
      ...overrides,
    };
  }

  it("valid payload → 200 {ok:true}, DB row pending with cancel_token, guest + owner outbox rows", async () => {
    const guest = uniqueGuest("create-valid");
    const response = await postCreate(validPayload(guest));
    expect(response.status).toBe(200);
    expect(await readJson(response, [guest])).toEqual({ ok: true, notified: true });

    // The server generated the row (anon has no SELECT policy) — verify via admin.
    const { data, error } = await admin
      .from("booking_requests")
      .select("status, cancel_token")
      .eq("guest_email", guest.guestEmail)
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe("pending");
    expect(data?.cancel_token).toBeTruthy();

    // FR: two transactional emails — guest confirmation + owner notification (index.ts:66-117).
    expect(await outboxCountFor(guest.guestEmail)).toBe(1);
    expect(await outboxCountFor(zagroda.ownerEmail)).toBe(1);
  });

  // Server-side parse parity: each hostile value trips the shared schema. Assert
  // status + the offending fieldErrors key (NOT the error copy — test-plan §2
  // anti-pattern: copy snapshots pin wording, not behaviour). One it.each per
  // distinct rule keeps each case catching a different regression.
  const INVALID_FIELD_CASES = [
    { label: "trip_date in the past", overrides: { trip_date: "2020-01-01" }, key: "trip_date" },
    { label: "zero participants", overrides: { participants_count: 0 }, key: "participants_count" },
    { label: "malformed guest_email", overrides: { guest_email: "definitely-not-an-email" }, key: "guest_email" },
  ] as const;

  it.each(INVALID_FIELD_CASES)("$label → 422 with fieldErrors.$key", async ({ overrides, key }) => {
    const guest = uniqueGuest("create-invalid");
    const body = validPayload(guest, overrides);
    const response = await postCreate(body);
    expect(response.status).toBe(422);
    // Assert against whatever values actually went out on the wire (an attacked
    // field may have replaced the unique guest value).
    const text = await response.text();
    assertNoContactData(text, { guest_email: String(body.guest_email), guest_phone: String(body.guest_phone) });
    const parsed = JSON.parse(text) as { error: string; fieldErrors?: Record<string, unknown> };
    expect(parsed.error).toBe("Sprawdź poprawność formularza");
    expect(parsed.fieldErrors).toHaveProperty(key);
  });

  it("unpublished (draft) zagroda → 422 'Zagroda niedostępna'", async () => {
    const ownerEmail = uniqueEmail("create-draft-owner");
    const { userId } = await createOwnerClient(ownerEmail, PASSWORD);
    const { zagrodaId, turnusIds } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30, published: false });
    const guest = uniqueGuest("create-draft");

    const response = await postCreate({
      zagroda_id: zagrodaId,
      turnus_id: turnusIds[0],
      trip_date: "2026-09-01",
      participants_count: 10,
      guest_name: guest.guestName,
      guest_email: guest.guestEmail,
      guest_phone: guest.guestPhone,
    });
    expect(response.status).toBe(422);
    expect(await readJson(response, [guest])).toEqual({ error: "Zagroda niedostępna" });

    // The draft never gained a request — the publication gate held.
    expect(await outboxCountFor(guest.guestEmail)).toBe(0);
  });

  it("turnus belonging to a different zagroda → 422 (composite FK rejection, no leak of why)", async () => {
    const guest = uniqueGuest("create-foreign-turnus");
    // Target zagroda is published (passes the lookup) but the turnus is foreign's:
    // the composite FK (turnus_id, zagroda_id) → turnusy(id, zagroda_id) rejects
    // the insert (domain_schema.sql:55), surfacing the generic 422 (index.ts:59-62).
    const response = await postCreate({
      zagroda_id: zagroda.zagrodaId,
      turnus_id: foreign.turnusId,
      trip_date: "2026-09-01",
      participants_count: 10,
      guest_name: guest.guestName,
      guest_email: guest.guestEmail,
      guest_phone: guest.guestPhone,
    });
    expect(response.status).toBe(422);
    expect(await readJson(response, [guest])).toEqual({
      error: "Nie udało się utworzyć zapytania. Sprawdź wybrany turnus i spróbuj ponownie.",
    });
  });

  it("non-JSON body → 400", async () => {
    const guest = uniqueGuest("create-badjson");
    // Raw string passes through createApiContext unstringified — a malformed body.
    const response = await postCreate("to nie json{{");
    expect(response.status).toBe(400);
    expect(await readJson(response, [guest])).toEqual({ error: "Nieprawidłowe dane żądania" });
  });
});

describe("POST /api/booking-request/cancel — token capability matrix (risk #5)", () => {
  let zagroda: PublishedZagroda;

  beforeAll(async () => {
    zagroda = await seedPublishedZagroda("cancel-owner");
  });

  /** Seeds a request via service-role and reads back its DB-generated cancel_token. */
  async function seedRequestWithToken(
    guest: GuestContact,
    status?: "pending" | "accepted",
  ): Promise<{ id: string; token: string }> {
    const id = await seedBookingRequest(admin, {
      zagrodaId: zagroda.zagrodaId,
      turnusId: zagroda.turnusId,
      tripDate: "2026-09-10",
      participants: 5,
      status,
      guestName: guest.guestName,
      guestEmail: guest.guestEmail,
      guestPhone: guest.guestPhone,
    });
    const { data, error } = await admin.from("booking_requests").select("cancel_token").eq("id", id).single();
    expect(error).toBeNull();
    if (!data?.cancel_token) throw new Error("seedRequestWithToken: cancel_token not generated");
    return { id, token: data.cancel_token };
  }

  async function statusOf(id: string): Promise<string> {
    const { data, error } = await admin.from("booking_requests").select("status").eq("id", id).single();
    expect(error).toBeNull();
    if (!data) throw new Error(`request ${id} not found`);
    return data.status;
  }

  it("non-JSON body → 400", async () => {
    const guest = uniqueGuest("cancel-badjson");
    const response = await postCancel("nie-json{{");
    expect(response.status).toBe(400);
    expect(await readJson(response, [guest])).toEqual({ error: "Nieprawidłowe dane żądania" });
  });

  it("valid JSON with a non-UUID token → 200 {status:'not_found'} (no existence signal)", async () => {
    const guest = uniqueGuest("cancel-nonuuid");
    const response = await postCancel({ token: "not-a-uuid" });
    expect(response.status).toBe(200);
    expect(await readJson(response, [guest])).toEqual({ status: "not_found" });
  });

  it("well-formed unknown UUID → 200 {status:'not_found'} (indistinguishable from non-uuid)", async () => {
    const guest = uniqueGuest("cancel-unknown");
    const response = await postCancel({ token: randomUUID() });
    expect(response.status).toBe(200);
    expect(await readJson(response, [guest])).toEqual({ status: "not_found" });
  });

  it("valid token on a pending request → 200 {status:'cancelled'}, row cancelled_by_guest; repeat → already_cancelled", async () => {
    const guest = uniqueGuest("cancel-pending");
    const { id, token } = await seedRequestWithToken(guest);

    const first = await postCancel({ token });
    expect(first.status).toBe(200);
    expect(await readJson(first, [guest])).toEqual({ status: "cancelled" });
    expect(await statusOf(id)).toBe("cancelled_by_guest");

    // Idempotent on a consumed token — the second call reports the resting state.
    const second = await postCancel({ token });
    expect(second.status).toBe(200);
    expect(await readJson(second, [guest])).toEqual({ status: "already_cancelled" });
    expect(await statusOf(id)).toBe("cancelled_by_guest");
  });

  it("token of an accepted request → 200 {status:'already_accepted'}, row stays accepted", async () => {
    const guest = uniqueGuest("cancel-accepted");
    const { id, token } = await seedRequestWithToken(guest, "accepted");

    const response = await postCancel({ token });
    expect(response.status).toBe(200);
    expect(await readJson(response, [guest])).toEqual({ status: "already_accepted" });
    // The token grants no power over an accepted request — it must not transition.
    expect(await statusOf(id)).toBe("accepted");
  });
});
