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

// Proof of teacher-contact privacy and the RLS-first posture:
// anon may only INSERT pending requests; reading requests (with contact data)
// is exclusively for the owner of that zagroda; state changes only through
// SECURITY DEFINER functions (no UPDATE/DELETE policies at all).

const PASSWORD = "test-password-123";

let admin: TypedClient;
let anon: TypedClient;
let owner: TypedClient;
let zagrodaId: string;
let turnusId: string;
let requestId: string;

const guestInsert = (status?: "pending" | "accepted") => ({
  zagroda_id: zagrodaId,
  turnus_id: turnusId,
  trip_date: "2026-07-01",
  participants_count: 5,
  ...(status ? { status } : {}),
  guest_name: "Anna Nauczycielka",
  guest_email: "anna@szkola.test",
  guest_phone: "+48 700 000 000",
});

beforeAll(async () => {
  admin = createAdminClient();
  anon = createAnonClient();
  const created = await createOwnerClient(uniqueEmail("rls-owner"), PASSWORD);
  owner = created.client;
  const seeded = await seedZagroda(admin, { ownerId: created.userId, dailyLimit: 30 });
  zagrodaId = seeded.zagrodaId;
  turnusId = seeded.turnusIds[0];
  requestId = await seedBookingRequest(admin, {
    zagrodaId,
    turnusId,
    tripDate: "2026-07-01",
    participants: 10,
  });
});

describe("RLS — booking_requests privacy & posture", () => {
  it("(a) anon can INSERT a pending booking request", async () => {
    // Bare .insert() without .select(): anon has no SELECT policy, so a
    // chained .select() would fail even on a successful insert (false negative).
    const { error } = await anon.from("booking_requests").insert(guestInsert());
    expect(error).toBeNull();
  });

  it("(b) anon can NOT INSERT a request with status other than pending", async () => {
    const { error } = await anon.from("booking_requests").insert(guestInsert("accepted"));
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501"); // RLS WITH CHECK violation
  });

  it("(c) anon sees no booking_requests at all (SELECT returns 0 rows)", async () => {
    const { data, error } = await anon.from("booking_requests").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("(d) the owner sees the requests of their zagroda, including contact data", async () => {
    const { data, error } = await owner
      .from("booking_requests")
      .select("id, guest_name, guest_email, guest_phone")
      .eq("id", requestId)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      guest_name: "Jan Testowy",
      guest_email: "jan@szkola.test",
      guest_phone: "+48 600 000 000",
    });
  });

  it("(e) another owner does not see someone else's requests", async () => {
    const { client: otherOwner } = await createOwnerClient(uniqueEmail("rls-other"), PASSWORD);
    const { data, error } = await otherOwner.from("booking_requests").select("*").eq("id", requestId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("(f) anon can not execute accept_booking_request (no EXECUTE privilege)", async () => {
    const { data, error } = await anon.rpc("accept_booking_request", { request_id: requestId });
    expect(data).toBeNull();
    expect(error?.code).toBe("42501"); // permission denied for function
  });

  it("(g) neither anon nor a foreign owner can UPDATE a request (no UPDATE policy)", async () => {
    const { client: otherOwner } = await createOwnerClient(uniqueEmail("rls-updater"), PASSWORD);

    // No UPDATE policy → RLS silently matches 0 rows; no error, no effect.
    const { error: anonError } = await anon.from("booking_requests").update({ status: "accepted" }).eq("id", requestId);
    expect(anonError).toBeNull();
    const { error: otherError } = await otherOwner
      .from("booking_requests")
      .update({ status: "accepted" })
      .eq("id", requestId);
    expect(otherError).toBeNull();

    const { data, error } = await admin.from("booking_requests").select("status").eq("id", requestId).single();
    expect(error).toBeNull();
    expect(data?.status).toBe("pending");
  });
});
