import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { APIRoute } from "astro";
import { POST as acceptPost } from "../../src/pages/api/booking-request/accept";
import { POST as rejectPost } from "../../src/pages/api/booking-request/reject";
import { POST as withdrawPost } from "../../src/pages/api/booking-request/withdraw";
import { POST as publishPost } from "../../src/pages/api/zagroda/publish";
import { assertNoContactData, CookieJar, createApiContext, runRoute, signInOwnerHttp } from "../helpers/api";
import {
  clearEmailConfirmation,
  createOwnerClient,
  createAdminClient,
  seedBookingRequest,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// Risks #4 + #6 at the HTTP layer. The regression net for "someone drops the
// RLS policy or switches a decision read to the admin client" (#4) and "the
// verified-email gate gets unwired" (#6). Two negative identities — anonymous
// and a foreign authenticated owner — are run against every decision route,
// the contact-data non-exposure invariant rides on every asserted response,
// and the publication gate is pinned to its exact 409 (with a verified control
// so the test can't pass for the wrong 409).

const PASSWORD = "test-password-123";

let admin: TypedClient;

beforeAll(() => {
  admin = createAdminClient();
});

const DECISION_ROUTES = [
  { name: "accept", handler: acceptPost, path: "/api/booking-request/accept" },
  { name: "reject", handler: rejectPost, path: "/api/booking-request/reject" },
  { name: "withdraw", handler: withdrawPost, path: "/api/booking-request/withdraw" },
] as const;

interface GuestContact {
  guestName: string;
  guestEmail: string;
  guestPhone: string;
}

/** Unique contact values so a leak would be unambiguous — assertNoContactData has something real to catch. */
function uniqueGuest(label: string): GuestContact {
  return {
    guestName: `Klasa ${label}`,
    guestEmail: uniqueEmail(`guest-${label}`),
    guestPhone: `+48 7${randomUUID().replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`,
  };
}

function postDecision(handler: APIRoute, route: string, jar: CookieJar, body: unknown): Promise<Response> {
  return runRoute(handler, createApiContext({ jar, path: route, body }));
}

/**
 * Reads the body once, enforces the contact-data non-exposure invariant (#4)
 * against every seeded guest in scope, and returns the parsed JSON. Applied to
 * EVERY decision-route response asserted here — 401s, 404s, 409s alike — so a
 * regression that leaks contact through any status code fails loudly.
 */
async function readBody(response: Response, guests: GuestContact[]): Promise<unknown> {
  const text = await response.text();
  for (const guest of guests) {
    assertNoContactData(text, { guest_email: guest.guestEmail, guest_phone: guest.guestPhone });
  }
  return JSON.parse(text) as unknown;
}

/** Owner A: confirmed, with a zagroda and one pending request carrying unique guest contact. */
async function seedOwnerWithPendingRequest(label: string): Promise<{ requestId: string; guest: GuestContact }> {
  const { userId } = await createOwnerClient(uniqueEmail(label), PASSWORD);
  const { zagrodaId, turnusIds } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });
  const guest = uniqueGuest(label);
  const requestId = await seedBookingRequest(admin, {
    zagrodaId,
    turnusId: turnusIds[0],
    tripDate: "2026-09-01",
    participants: 10,
    ...guest,
  });
  return { requestId, guest };
}

describe("authorization surfaces — HTTP surface", () => {
  describe("anonymous matrix → 401 on every decision route", () => {
    // A real seeded request gives the assertion something to catch: a handler
    // that read the row before the auth gate would leak this guest's contact.
    let requestId: string;
    let guest: GuestContact;

    beforeAll(async () => {
      ({ requestId, guest } = await seedOwnerWithPendingRequest("anon"));
    });

    for (const route of DECISION_ROUTES) {
      it(`${route.name}: empty jar → 401, no contact leak`, async () => {
        const response = await postDecision(route.handler, route.path, new CookieJar(), { id: requestId });
        expect(response.status).toBe(401);
        expect(await readBody(response, [guest])).toEqual({ error: "Zaloguj się, aby zarządzać rezerwacjami" });
      });
    }
  });

  describe("foreign-owner matrix → 404 (not 403) on every decision route", () => {
    // Owner A owns the request; owner B (a different confirmed owner) attacks it.
    // 404 — NOT 403 — is the correct outcome: the handler's RLS-scoped pre-SELECT
    // (accept.ts:42-51) returns null for a row B cannot see, so the RPC never
    // runs. A 403 here would mean RLS was bypassed and only the RPC's ownership
    // re-check caught it — i.e. the row was readable when it shouldn't be.
    let requestId: string;
    let guest: GuestContact;
    let attackerJar: CookieJar;

    beforeAll(async () => {
      ({ requestId, guest } = await seedOwnerWithPendingRequest("foreign-victim"));
      const attackerEmail = uniqueEmail("foreign-attacker");
      await createOwnerClient(attackerEmail, PASSWORD);
      attackerJar = new CookieJar();
      await signInOwnerHttp(attackerJar, attackerEmail, PASSWORD);
    });

    for (const route of DECISION_ROUTES) {
      it(`${route.name}: owner B on owner A's request → 404, no contact leak`, async () => {
        const response = await postDecision(route.handler, route.path, attackerJar, { id: requestId });
        expect(response.status).toBe(404);
        expect(await readBody(response, [guest])).toEqual({ error: "Zapytanie nie istnieje" });
      });
    }
  });

  it("unverified owner accepting own request → 409 verification gate, no contact leak", async () => {
    // Sequencing (Critical Implementation Details): create confirmed → HTTP
    // signin (jar gets cookies) → clear email_confirmed_at → call the route.
    // Clearing before signin would break (GoTrue blocks unconfirmed signins).
    const email = uniqueEmail("unverified");
    const { userId } = await createOwnerClient(email, PASSWORD);
    const { zagrodaId, turnusIds } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });
    const guest = uniqueGuest("unverified");
    const requestId = await seedBookingRequest(admin, {
      zagrodaId,
      turnusId: turnusIds[0],
      tripDate: "2026-09-02",
      participants: 10,
      ...guest,
    });

    const jar = new CookieJar();
    await signInOwnerHttp(jar, email, PASSWORD);
    await clearEmailConfirmation(userId);

    const response = await postDecision(acceptPost, "/api/booking-request/accept", jar, { id: requestId });
    expect(response.status).toBe(409);
    expect(await readBody(response, [guest])).toEqual({
      error: "Zweryfikuj adres e-mail, aby zarządzać rezerwacjami",
    });
  });

  describe("publication gate (risk #6)", () => {
    // The fixture is publish-complete (seedZagroda defaults: name/description/
    // voivodeship/city set, one turnus) so the ONLY thing that can block publish
    // is the email-verification gate — not profile_incomplete or no_turnus, which
    // are also 409s (publish.ts:20-36). Exact-message match is what separates them.
    it("unverified owner → 409 with the exact verification message", async () => {
      const email = uniqueEmail("publish-unverified");
      const { userId } = await createOwnerClient(email, PASSWORD);
      await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });

      const jar = new CookieJar();
      await signInOwnerHttp(jar, email, PASSWORD);
      await clearEmailConfirmation(userId);

      const response = await runRoute(
        publishPost,
        createApiContext({ jar, path: "/api/zagroda/publish", body: { publish: true } }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "Zweryfikuj adres e-mail, aby opublikować zagrodę" });
    });

    it("verified owner (control) → 200 is_published", async () => {
      const email = uniqueEmail("publish-verified");
      const { userId } = await createOwnerClient(email, PASSWORD);
      await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });

      const jar = new CookieJar();
      await signInOwnerHttp(jar, email, PASSWORD);

      const response = await runRoute(
        publishPost,
        createApiContext({ jar, path: "/api/zagroda/publish", body: { publish: true } }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ is_published: true });
    });
  });
});
