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

// Proof of the S-01 catalog visibility semantics (FR-010) and the FK
// hardening: published zagrody are public, drafts are owner-only, turnusy
// follow their parent, and turnusy referenced by booking requests cannot
// be deleted (12-month history NFR; lessons.md immutability rule).

const PASSWORD = "test-password-123";

let admin: TypedClient;
let anon: TypedClient;
let owner: TypedClient;
let ownerId: string;
let publishedId: string;
let draftId: string;
let publishedTurnusIds: string[];
let draftTurnusIds: string[];

beforeAll(async () => {
  admin = createAdminClient();
  anon = createAnonClient();
  const created = await createOwnerClient(uniqueEmail("vis-owner"), PASSWORD);
  owner = created.client;
  ownerId = created.userId;

  // One owner cannot hold two zagrody (owner_id UNIQUE) — the draft belongs
  // to a second owner so both states coexist.
  const published = await seedZagroda(admin, { ownerId, dailyLimit: 30, published: true });
  publishedId = published.zagrodaId;
  publishedTurnusIds = published.turnusIds;

  const draftOwner = await createOwnerClient(uniqueEmail("vis-draft-owner"), PASSWORD);
  const draft = await seedZagroda(admin, { ownerId: draftOwner.userId, dailyLimit: 20 });
  draftId = draft.zagrodaId;
  draftTurnusIds = draft.turnusIds;
});

describe("RLS — catalog visibility (published vs draft)", () => {
  it("(a) anon sees the published zagroda but not the draft", async () => {
    const { data: pub, error: pubError } = await anon.from("zagrody").select("id").eq("id", publishedId);
    expect(pubError).toBeNull();
    expect(pub).toHaveLength(1);

    const { data: draft, error: draftError } = await anon.from("zagrody").select("id").eq("id", draftId);
    expect(draftError).toBeNull();
    expect(draft).toHaveLength(0);
  });

  it("(b) the owner sees their own draft", async () => {
    const { client: draftOwner2, userId: draftOwner2Id } = await createOwnerClient(
      uniqueEmail("vis-own-draft"),
      PASSWORD,
    );
    const { zagrodaId } = await seedZagroda(admin, { ownerId: draftOwner2Id, dailyLimit: 10 });

    const { data, error } = await draftOwner2.from("zagrody").select("id").eq("id", zagrodaId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("(c) a foreign authenticated owner does NOT see another's draft", async () => {
    const { data, error } = await owner.from("zagrody").select("id").eq("id", draftId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("(d) turnusy visibility follows the parent zagroda", async () => {
    // Published parent: anon sees its turnusy.
    const { data: pubTurnusy, error: pubError } = await anon
      .from("turnusy")
      .select("id")
      .eq("id", publishedTurnusIds[0]);
    expect(pubError).toBeNull();
    expect(pubTurnusy).toHaveLength(1);

    // Draft parent: invisible to anon AND to a foreign authenticated owner.
    const { data: draftTurnusyAnon } = await anon.from("turnusy").select("id").eq("id", draftTurnusIds[0]);
    expect(draftTurnusyAnon).toHaveLength(0);

    const { data: draftTurnusyForeign } = await owner.from("turnusy").select("id").eq("id", draftTurnusIds[0]);
    expect(draftTurnusyForeign).toHaveLength(0);
  });
});

describe("FK guard — turnus deletion vs booking history", () => {
  it("(e) deleting a turnus with a booking_request fails with FK violation (23503)", async () => {
    await seedBookingRequest(admin, {
      zagrodaId: publishedId,
      turnusId: publishedTurnusIds[0],
      tripDate: "2026-07-01",
      participants: 10,
    });

    // Even the service-role client must be blocked — RESTRICT is a constraint,
    // not a policy.
    const { error } = await admin.from("turnusy").delete().eq("id", publishedTurnusIds[0]);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503"); // foreign_key_violation

    // And the owner via RLS path is blocked the same way.
    const { error: ownerError } = await owner.from("turnusy").delete().eq("id", publishedTurnusIds[0]);
    expect(ownerError).not.toBeNull();
    expect(ownerError?.code).toBe("23503");
  });

  it("(f) deleting a turnus with no requests succeeds", async () => {
    const { data: fresh, error: insertError } = await admin
      .from("turnusy")
      .insert({ zagroda_id: publishedId, label: "Do skasowania", start_time: "15:00", end_time: "16:00" })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    if (!fresh) throw new Error("turnus insert returned no row");

    const { error } = await owner.from("turnusy").delete().eq("id", fresh.id);
    expect(error).toBeNull();

    const { data: gone } = await admin.from("turnusy").select("id").eq("id", fresh.id);
    expect(gone).toHaveLength(0);
  });
});
