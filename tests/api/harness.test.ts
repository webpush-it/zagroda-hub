import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as acceptPost } from "../../src/pages/api/booking-request/accept";
import { CookieJar, createApiContext, runRoute, signInOwnerHttp } from "../helpers/api";
import {
  createAdminClient,
  createOwnerClient,
  seedBookingRequest,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// Harness smoke: prove middleware composition + HTTP signin + RLS end-to-end
// BEFORE any risk suite depends on these helpers. The 404 case is the
// discriminator — an anonymous request gets 401, so a 404 proves the session
// cookie traversed the real middleware and locals.user was populated.

const PASSWORD = "test-password-123";

let admin: TypedClient;

beforeAll(() => {
  admin = createAdminClient();
});

describe("HTTP-surface harness — smoke", () => {
  it("anonymous accept → 401", async () => {
    const ctx = createApiContext({ path: "/api/booking-request/accept", body: { id: randomUUID() } });
    const response = await runRoute(acceptPost, ctx);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Zaloguj się, aby zarządzać rezerwacjami" });
  });

  it("signed-in owner, nonexistent id → 404 (session traversed middleware)", async () => {
    const email = uniqueEmail("smoke");
    await createOwnerClient(email, PASSWORD);
    const jar = new CookieJar();
    await signInOwnerHttp(jar, email, PASSWORD);

    const ctx = createApiContext({ jar, path: "/api/booking-request/accept", body: { id: randomUUID() } });
    const response = await runRoute(acceptPost, ctx);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Zapytanie nie istnieje" });
  });

  it("signed-in owner accepts own pending request → 200 and DB row accepted", async () => {
    const email = uniqueEmail("smoke");
    const { userId } = await createOwnerClient(email, PASSWORD);
    const { zagrodaId, turnusIds } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });
    const requestId = await seedBookingRequest(admin, {
      zagrodaId,
      turnusId: turnusIds[0],
      tripDate: "2026-07-01",
      participants: 10,
    });

    const jar = new CookieJar();
    await signInOwnerHttp(jar, email, PASSWORD);

    const ctx = createApiContext({ jar, path: "/api/booking-request/accept", body: { id: requestId } });
    const response = await runRoute(acceptPost, ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "accepted", notified: true });

    const { data: row, error } = await admin.from("booking_requests").select("status").eq("id", requestId).single();
    expect(error).toBeNull();
    expect(row?.status).toBe("accepted");
  });
});
