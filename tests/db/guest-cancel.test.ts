import { randomUUID } from "node:crypto";
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

// S-03 guest self-cancel primitive. cancel_booking_request is the ONLY
// guest-driven transition (anon-callable SECURITY DEFINER; no UPDATE policy).
// It flips a still-pending request to cancelled_by_guest, is idempotent on a
// consumed token, refuses anything not pending, and never touches the
// immutable lock-order columns (zagroda_id / turnus_id / trip_date).

const PASSWORD = "test-password-123";

let admin: TypedClient;
let anon: TypedClient;
let ownerId: string;
let zagrodaId: string;
let turnusId: string;

beforeAll(async () => {
  admin = createAdminClient();
  anon = createAnonClient();
  const created = await createOwnerClient(uniqueEmail("cancel-owner"), PASSWORD);
  ownerId = created.userId;
  const seeded = await seedZagroda(admin, { ownerId, dailyLimit: 30 });
  zagrodaId = seeded.zagrodaId;
  turnusId = seeded.turnusIds[0];
});

async function seedWithToken(status?: "pending" | "accepted") {
  const id = await seedBookingRequest(admin, {
    zagrodaId,
    turnusId,
    tripDate: "2026-07-01",
    participants: 5,
    status,
  });
  const { data, error } = await admin.from("booking_requests").select("cancel_token").eq("id", id).single();
  if (error) throw new Error(error.message);
  return { id, token: data.cancel_token };
}

async function cancel(token: string) {
  const { data, error } = await anon.rpc("cancel_booking_request", { p_token: token });
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

describe("cancel_booking_request — guest self-cancel", () => {
  it("(a) a valid token cancels a pending request", async () => {
    const { id, token } = await seedWithToken();

    const { row, error } = await cancel(token);

    expect(error).toBeNull();
    expect(row).toMatchObject({ cancelled: true, status: "cancelled_by_guest" });
    await expect(rowOf(id).then((r) => r.status)).resolves.toBe("cancelled_by_guest");
  });

  it("(b) a second call with the same token is a no-op (idempotent)", async () => {
    const { token } = await seedWithToken();

    const first = await cancel(token);
    expect(first.row).toMatchObject({ cancelled: true, status: "cancelled_by_guest" });

    const second = await cancel(token);
    expect(second.error).toBeNull();
    expect(second.row).toMatchObject({ cancelled: false, status: "cancelled_by_guest" });
  });

  it("(c) an accepted request cannot be guest-cancelled; it is left unchanged", async () => {
    const { id, token } = await seedWithToken("accepted");

    const { row, error } = await cancel(token);

    expect(error).toBeNull();
    expect(row).toMatchObject({ cancelled: false, status: "accepted" });
    await expect(rowOf(id).then((r) => r.status)).resolves.toBe("accepted");
  });

  it("(d) an unknown token returns cancelled=false, status=null", async () => {
    const { row, error } = await cancel(randomUUID());

    expect(error).toBeNull();
    expect(row).toMatchObject({ cancelled: false, status: null });
  });

  it("(e) cancel does not change the immutable lock-order columns", async () => {
    const { id, token } = await seedWithToken();
    const before = await rowOf(id);

    await cancel(token);

    const after = await rowOf(id);
    expect(after).toMatchObject({
      zagroda_id: before.zagroda_id,
      turnus_id: before.turnus_id,
      trip_date: before.trip_date,
    });
  });

  it("(f) anon INSERT without supplying cancel_token still succeeds (default fires)", async () => {
    // Guards the F-01 rls.test contract: the new NOT NULL column has a DEFAULT,
    // so the existing token-less anon insert path keeps working.
    const { error } = await anon.from("booking_requests").insert({
      zagroda_id: zagrodaId,
      turnus_id: turnusId,
      trip_date: "2026-07-02",
      participants_count: 3,
      guest_name: "Anna Nauczycielka",
      guest_email: "anna@szkola.test",
      guest_phone: "+48 700 000 000",
    });
    expect(error).toBeNull();
  });
});
