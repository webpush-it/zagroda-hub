import { beforeAll, describe, expect, it } from "vitest";
import {
  createAdminClient,
  createAnonClient,
  createOwnerClient,
  createUnverifiedOwnerClient,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// Proof of the S-01 publication gates as observable behavior (FR-006, FR-009,
// FR-010): publish requires a verified e-mail, a complete profile and >= 1
// turnus; the is_published flag is mutable ONLY through set_zagroda_published()
// (trigger guard + INSERT policy WITH CHECK). Photo is deliberately optional.

const PASSWORD = "test-password-123";

let admin: TypedClient;
let anon: TypedClient;

beforeAll(() => {
  admin = createAdminClient();
  anon = createAnonClient();
});

describe("set_zagroda_published — publication gates", () => {
  it("(a) verified owner + complete profile + turnus -> publish succeeds and anon sees the row", async () => {
    const { client: owner, userId } = await createOwnerClient(uniqueEmail("pub-a"), PASSWORD);
    const { zagrodaId } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });

    const { data, error } = await owner.rpc("set_zagroda_published", {
      target_zagroda_id: zagrodaId,
      publish: true,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);

    const { data: anonRows, error: anonError } = await anon.from("zagrody").select("id").eq("id", zagrodaId);
    expect(anonError).toBeNull();
    expect(anonRows).toHaveLength(1);
  });

  it("(b) unverified owner -> publish blocked with email_not_verified", async () => {
    const { client: owner, userId } = await createUnverifiedOwnerClient(uniqueEmail("pub-b"), PASSWORD);
    const { zagrodaId } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });

    const { data, error } = await owner.rpc("set_zagroda_published", {
      target_zagroda_id: zagrodaId,
      publish: true,
    });
    expect(data).toBeNull();
    expect(error?.code).toBe("55000");
    expect(error?.message).toContain("email_not_verified");
  });

  it("(c) verified owner, zero turnusy -> publish blocked with no_turnus", async () => {
    const { client: owner, userId } = await createOwnerClient(uniqueEmail("pub-c"), PASSWORD);
    const { zagrodaId } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30, turnusCount: 0 });

    const { error } = await owner.rpc("set_zagroda_published", {
      target_zagroda_id: zagrodaId,
      publish: true,
    });
    expect(error?.code).toBe("55000");
    expect(error?.message).toContain("no_turnus");
  });

  it("(d) missing required fields -> publish blocked with profile_incomplete naming them", async () => {
    const { client: owner, userId } = await createOwnerClient(uniqueEmail("pub-d"), PASSWORD);
    const { zagrodaId } = await seedZagroda(admin, {
      ownerId: userId,
      dailyLimit: 30,
      description: null,
      city: "   ", // whitespace-only counts as missing
    });

    const { error } = await owner.rpc("set_zagroda_published", {
      target_zagroda_id: zagrodaId,
      publish: true,
    });
    expect(error?.code).toBe("55000");
    expect(error?.message).toContain("profile_incomplete");
    expect(error?.message).toContain("description");
    expect(error?.message).toContain("city");
  });

  it("(e) photo absent -> publish still succeeds (photo is optional)", async () => {
    const { client: owner, userId } = await createOwnerClient(uniqueEmail("pub-e"), PASSWORD);
    const { zagrodaId } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });

    // seedZagroda never sets photo_path — assert it is indeed NULL, then publish.
    const { data: row } = await admin.from("zagrody").select("photo_path").eq("id", zagrodaId).single();
    expect(row?.photo_path).toBeNull();

    const { data, error } = await owner.rpc("set_zagroda_published", {
      target_zagroda_id: zagrodaId,
      publish: true,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it("(f) a non-owner caller -> 42501", async () => {
    const { userId } = await createOwnerClient(uniqueEmail("pub-f-owner"), PASSWORD);
    const { client: intruder } = await createOwnerClient(uniqueEmail("pub-f-intruder"), PASSWORD);
    const { zagrodaId } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });

    const { error } = await intruder.rpc("set_zagroda_published", {
      target_zagroda_id: zagrodaId,
      publish: true,
    });
    expect(error?.code).toBe("42501");
  });

  it("(g) nonexistent zagroda id -> P0002", async () => {
    const { client: owner } = await createOwnerClient(uniqueEmail("pub-g"), PASSWORD);

    const { error } = await owner.rpc("set_zagroda_published", {
      target_zagroda_id: "00000000-0000-0000-0000-000000000000",
      publish: true,
    });
    expect(error?.code).toBe("P0002");
  });

  it("(h) unpublish succeeds without gate validations and hides the row from anon", async () => {
    const { client: owner, userId } = await createOwnerClient(uniqueEmail("pub-h"), PASSWORD);
    // Incomplete profile (no description) seeded as published: unpublish must
    // still work — gates apply only to publish=true.
    const { zagrodaId } = await seedZagroda(admin, {
      ownerId: userId,
      dailyLimit: 30,
      description: null,
      published: true,
    });

    const { data, error } = await owner.rpc("set_zagroda_published", {
      target_zagroda_id: zagrodaId,
      publish: false,
    });
    expect(error).toBeNull();
    expect(data).toBe(false);

    const { data: anonRows } = await anon.from("zagrody").select("id").eq("id", zagrodaId);
    expect(anonRows).toHaveLength(0);
  });

  it("(i) direct UPDATE of is_published as owner -> rejected by the trigger guard", async () => {
    const { client: owner, userId } = await createOwnerClient(uniqueEmail("pub-i"), PASSWORD);
    const { zagrodaId } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30 });

    const { error } = await owner.from("zagrody").update({ is_published: true }).eq("id", zagrodaId);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");

    const { data: row } = await admin.from("zagrody").select("is_published").eq("id", zagrodaId).single();
    expect(row?.is_published).toBe(false);
  });

  it("(j) INSERT with is_published = true as owner -> rejected by the INSERT policy WITH CHECK", async () => {
    const { client: owner, userId } = await createOwnerClient(uniqueEmail("pub-j"), PASSWORD);

    const { error } = await owner.from("zagrody").insert({
      owner_id: userId,
      name: "Smuggled published zagroda",
      daily_limit: 10,
      is_published: true,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501"); // RLS WITH CHECK violation
  });
});
