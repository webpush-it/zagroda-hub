import { beforeAll, describe, expect, it } from "vitest";
import {
  createAdminClient,
  createAnonClient,
  createOwnerClient,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// S-12 oferty (FR-024, FR-025, FR-031). Owner-owned display-only offers on a
// zagroda: owner CRUDs under RLS (no RPC — no cross-row invariant), the public
// read gates on BOTH zagrody.is_published AND oferty.is_active (soft delete).
// CHECKs enforce non-empty taxonomy arrays and the amount<->unit coupling.

const PASSWORD = "test-password-123";

let admin: TypedClient;
let owner: TypedClient;
let draftOwner: TypedClient;
let publishedZagrodaId: string;
let draftZagrodaId: string;

beforeAll(async () => {
  admin = createAdminClient();
  // zagrody.owner_id is unique (one zagroda per owner), so the published and
  // draft fixtures need distinct owners to drive the publish gate.
  const created = await createOwnerClient(uniqueEmail("oferty-owner"), PASSWORD);
  owner = created.client;
  publishedZagrodaId = (await seedZagroda(admin, { ownerId: created.userId, dailyLimit: 30, published: true }))
    .zagrodaId;

  const draft = await createOwnerClient(uniqueEmail("oferty-draft-owner"), PASSWORD);
  draftOwner = draft.client;
  draftZagrodaId = (await seedZagroda(admin, { ownerId: draft.userId, dailyLimit: 30, published: false })).zagrodaId;
});

/** Narrows a possibly-null query result, failing loudly instead of via a non-null assertion. */
function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected a non-null query result");
  return value;
}

/** Inserts an offer as the given owner client (authenticated, under RLS). */
async function insertOffer(client: TypedClient, zagrodaId: string, overrides: Record<string, unknown> = {}) {
  return client
    .from("oferty")
    .insert({
      zagroda_id: zagrodaId,
      nazwa: "Warsztaty pieczenia chleba",
      temat: ["kuchnia_domowa", "tradycyjna_zywnosc"],
      adresaci: ["szkoly_podstawowe", "rodziny"],
      ...overrides,
    } as never)
    .select()
    .single();
}

describe("oferty — owner CRUD + taxonomy", () => {
  it("(a) owner inserts an offer with multiple temat/adresaci and reads it back", async () => {
    const { data, error } = await insertOffer(owner, publishedZagrodaId, {
      amount_grosze: 2500,
      price_unit: "za_osobe",
      opis: "Od ziarna do bochenka.",
      czas_trwania: "2h",
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      nazwa: "Warsztaty pieczenia chleba",
      temat: ["kuchnia_domowa", "tradycyjna_zywnosc"],
      adresaci: ["szkoly_podstawowe", "rodziny"],
      amount_grosze: 2500,
      price_unit: "za_osobe",
      is_active: true,
    });

    const inserted = must(data);
    const { data: readBack } = await owner.from("oferty").select("id").eq("id", inserted.id).single();
    expect(readBack?.id).toBe(inserted.id);
  });
});

describe("oferty — publish + active gated public read", () => {
  it("(b) anon reads an offer only when the zagroda is published and the offer is active", async () => {
    const { data: onPublished } = await insertOffer(owner, publishedZagrodaId);
    const { data: onDraft } = await insertOffer(draftOwner, draftZagrodaId);

    const anon = createAnonClient();

    const { data: visible, error: visErr } = await anon.from("oferty").select("id").eq("id", must(onPublished).id);
    expect(visErr).toBeNull();
    expect(visible).toHaveLength(1);

    const { data: hidden } = await anon.from("oferty").select("id").eq("id", must(onDraft).id);
    expect(hidden).toHaveLength(0);
  });

  it("(d) a soft-deleted offer is invisible to anon but still visible to its owner", async () => {
    const { data } = await insertOffer(owner, publishedZagrodaId);
    const offer = must(data);

    // Soft delete.
    const { error: delErr } = await owner.from("oferty").update({ is_active: false }).eq("id", offer.id);
    expect(delErr).toBeNull();

    const anon = createAnonClient();
    const { data: anonSees } = await anon.from("oferty").select("id").eq("id", offer.id);
    expect(anonSees).toHaveLength(0);

    const { data: ownerSees } = await owner.from("oferty").select("id, is_active").eq("id", offer.id).single();
    expect(ownerSees).toMatchObject({ id: offer.id, is_active: false });
  });
});

describe("oferty — owner isolation (RLS)", () => {
  it("(c) a second owner cannot update or delete the first owner's offer", async () => {
    const { data } = await insertOffer(owner, publishedZagrodaId, { nazwa: "Tylko moja oferta" });
    const offer = must(data);
    const { client: stranger } = await createOwnerClient(uniqueEmail("oferty-stranger"), PASSWORD);

    // Update: RLS scopes to ownership → matches 0 rows, no error, row unchanged.
    const { error: updErr } = await stranger.from("oferty").update({ nazwa: "Przejęta" }).eq("id", offer.id);
    expect(updErr).toBeNull();

    // Delete (hard): also scoped out → 0 rows.
    const { error: hardDelErr } = await stranger.from("oferty").delete().eq("id", offer.id);
    expect(hardDelErr).toBeNull();

    // The owner's row is untouched and still present.
    const { data: after } = await owner.from("oferty").select("nazwa").eq("id", offer.id).single();
    expect(after?.nazwa).toBe("Tylko moja oferta");
  });
});

describe("oferty — CHECK constraints", () => {
  it("(e1) an empty temat array is rejected", async () => {
    const { error } = await insertOffer(owner, publishedZagrodaId, { temat: [] });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/oferty_temat_nonempty|violates check/i);
  });

  it("(e2) an empty adresaci array is rejected", async () => {
    const { error } = await insertOffer(owner, publishedZagrodaId, { adresaci: [] });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/oferty_adresaci_nonempty|violates check/i);
  });

  it("(e3) an amount with no price_unit is rejected", async () => {
    const { error } = await insertOffer(owner, publishedZagrodaId, { amount_grosze: 2500, price_unit: null });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/oferty_amount_needs_unit|violates check/i);
  });

  it("(e4) a non-positive amount is rejected", async () => {
    const { error } = await insertOffer(owner, publishedZagrodaId, { amount_grosze: 0, price_unit: "za_osobe" });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/oferty_amount_positive|violates check/i);
  });
});
