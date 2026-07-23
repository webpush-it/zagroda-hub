import { beforeAll, describe, expect, it } from "vitest";
import type { APIRoute } from "astro";
import { POST as offerPost, PATCH as offerPatch, DELETE as offerDelete } from "../../src/pages/api/offer/index";
import { POST as reorderPost } from "../../src/pages/api/offer/reorder";
import { CookieJar, createApiContext, runRoute, signInOwnerHttp } from "../helpers/api";
import {
  clearEmailConfirmation,
  createAdminClient,
  createOwnerClient,
  seedZagroda,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// S-12 at the HTTP layer: the /api/offer routes wire owner input → RLS-scoped
// write → response. Owner isolation, publish/active gating and the CHECKs are
// proven against the DB in tests/db/oferty.test.ts — these tests assert the
// auth gate, the zod parse (empty taxonomy, price without unit), the
// server-side zagroda resolution, and the create/edit/soft-delete/reorder
// contracts, plus that a foreign owner is denied (404, row untouched).

const PASSWORD = "test-password-123";

let admin: TypedClient;

beforeAll(() => {
  admin = createAdminClient();
});

interface OwnerFixture {
  email: string;
  userId: string;
  zagrodaId: string;
  jar: CookieJar;
}

/** Fresh owner + published zagroda + signed-in jar. One per test: owner_id is UNIQUE. */
async function createOwnerFixture(): Promise<OwnerFixture> {
  const email = uniqueEmail("offer");
  const { userId } = await createOwnerClient(email, PASSWORD);
  const { zagrodaId } = await seedZagroda(admin, { ownerId: userId, dailyLimit: 30, published: true });
  const jar = new CookieJar();
  await signInOwnerHttp(jar, email, PASSWORD);
  return { email, userId, zagrodaId, jar };
}

function call(handler: APIRoute, jar: CookieJar, body: unknown, method = "POST"): Promise<Response> {
  return runRoute(handler, createApiContext({ jar, method, path: "/api/offer", body }));
}

/** A valid offer payload; override exactly the attacked field. */
function offerPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nazwa: "Warsztaty pieczenia chleba",
    temat: ["kuchnia_domowa", "tradycyjna_zywnosc"],
    adresaci: ["szkoly_podstawowe", "rodziny"],
    ...overrides,
  };
}

describe("POST /api/offer — auth gate", () => {
  it("anonymous → 401", async () => {
    const response = await call(offerPost, new CookieJar(), offerPayload());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Zaloguj się, aby zarządzać ofertami" });
  });

  it("unverified owner → 409 verification gate", async () => {
    const email = uniqueEmail("offer-unverified");
    const { userId } = await createOwnerClient(email, PASSWORD);
    await seedZagroda(admin, { ownerId: userId, dailyLimit: 30, published: true });
    const jar = new CookieJar();
    await signInOwnerHttp(jar, email, PASSWORD);
    await clearEmailConfirmation(userId);

    const response = await call(offerPost, jar, offerPayload());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Zweryfikuj adres e-mail, aby zarządzać ofertami" });
  });

  it("owner with no zagroda → 409 create-profile-first", async () => {
    const email = uniqueEmail("offer-nozagroda");
    await createOwnerClient(email, PASSWORD);
    const jar = new CookieJar();
    await signInOwnerHttp(jar, email, PASSWORD);

    const response = await call(offerPost, jar, offerPayload());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Najpierw utwórz profil zagrody, aby dodać oferty" });
  });
});

describe("POST /api/offer — validation", () => {
  const INVALID_FIELD_CASES = [
    { label: "empty temat", overrides: { temat: [] }, key: "temat" },
    { label: "empty adresaci", overrides: { adresaci: [] }, key: "adresaci" },
    { label: "blank nazwa", overrides: { nazwa: "" }, key: "nazwa" },
    { label: "price without unit", overrides: { amount_grosze: 2500 }, key: "price_unit" },
    { label: "unit without price", overrides: { price_unit: "za_osobe" }, key: "price_unit" },
    { label: "non-positive amount", overrides: { amount_grosze: 0, price_unit: "za_osobe" }, key: "amount_grosze" },
  ] as const;

  it.each(INVALID_FIELD_CASES)("$label → 422 with fieldErrors.$key", async ({ overrides, key }) => {
    const fixture = await createOwnerFixture();
    const response = await call(offerPost, fixture.jar, offerPayload(overrides));
    expect(response.status).toBe(422);
    const parsed = (await response.json()) as { error: string; fieldErrors?: Record<string, unknown> };
    expect(parsed.error).toBe("Sprawdź poprawność formularza");
    expect(parsed.fieldErrors).toHaveProperty(key);
  });

  it("non-JSON body → 400", async () => {
    const fixture = await createOwnerFixture();
    const response = await call(offerPost, fixture.jar, "to nie json{{");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Nieprawidłowe dane żądania" });
  });
});

describe("POST /api/offer — create", () => {
  it("valid create → 200 {ok, id}; row persisted with the zagroda resolved server-side", async () => {
    const fixture = await createOwnerFixture();
    const response = await call(
      offerPost,
      fixture.jar,
      offerPayload({ amount_grosze: 2500, price_unit: "za_osobe", opis: "Od ziarna do bochenka.", czas_trwania: "2h" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();

    const { data, error } = await admin
      .from("oferty")
      .select(
        "zagroda_id, nazwa, opis, czas_trwania, temat, adresaci, amount_grosze, price_unit, is_active, sort_order",
      )
      .eq("id", body.id)
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({
      zagroda_id: fixture.zagrodaId,
      nazwa: "Warsztaty pieczenia chleba",
      opis: "Od ziarna do bochenka.",
      czas_trwania: "2h",
      temat: ["kuchnia_domowa", "tradycyjna_zywnosc"],
      adresaci: ["szkoly_podstawowe", "rodziny"],
      amount_grosze: 2500,
      price_unit: "za_osobe",
      is_active: true,
      sort_order: 0,
    });
  });

  it("create with no price → row stored with null amount/unit; sort_order appends", async () => {
    const fixture = await createOwnerFixture();
    const a = await call(offerPost, fixture.jar, offerPayload({ nazwa: "Pierwsza" }));
    const b = await call(offerPost, fixture.jar, offerPayload({ nazwa: "Druga" }));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const idA = ((await a.json()) as { id: string }).id;
    const idB = ((await b.json()) as { id: string }).id;

    const { data } = await admin
      .from("oferty")
      .select("id, amount_grosze, price_unit, sort_order")
      .in("id", [idA, idB]);
    const rows = data ?? [];
    const rowA = rows.find((r) => r.id === idA);
    const rowB = rows.find((r) => r.id === idB);
    expect(rowA).toMatchObject({ amount_grosze: null, price_unit: null, sort_order: 0 });
    expect(rowB).toMatchObject({ sort_order: 1 });
  });
});

describe("PATCH /api/offer — edit", () => {
  it("edits fields of the owner's offer → 200; row updated", async () => {
    const fixture = await createOwnerFixture();
    const created = await call(offerPost, fixture.jar, offerPayload());
    const { id } = (await created.json()) as { id: string };

    const response = await call(
      offerPatch,
      fixture.jar,
      {
        id,
        ...offerPayload({
          nazwa: "Nowa nazwa",
          temat: ["przyroda"],
          adresaci: ["seniorzy"],
          amount_grosze: 5000,
          price_unit: "za_grupe",
        }),
      },
      "PATCH",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const { data } = await admin
      .from("oferty")
      .select("nazwa, temat, adresaci, amount_grosze, price_unit")
      .eq("id", id)
      .single();
    expect(data).toEqual({
      nazwa: "Nowa nazwa",
      temat: ["przyroda"],
      adresaci: ["seniorzy"],
      amount_grosze: 5000,
      price_unit: "za_grupe",
    });
  });

  it("foreign owner PATCH → 404, victim row untouched", async () => {
    const victim = await createOwnerFixture();
    const attacker = await createOwnerFixture();
    const created = await call(offerPost, victim.jar, offerPayload({ nazwa: "Tylko moja" }));
    const { id } = (await created.json()) as { id: string };

    const response = await call(offerPatch, attacker.jar, { id, ...offerPayload({ nazwa: "Przejęta" }) }, "PATCH");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Nie znaleziono oferty" });

    const { data } = await admin.from("oferty").select("nazwa").eq("id", id).single();
    expect(data?.nazwa).toBe("Tylko moja");
  });
});

describe("DELETE /api/offer — soft delete", () => {
  it("owner soft-deletes → 200; is_active=false, row still present", async () => {
    const fixture = await createOwnerFixture();
    const created = await call(offerPost, fixture.jar, offerPayload());
    const { id } = (await created.json()) as { id: string };

    const response = await call(offerDelete, fixture.jar, { id }, "DELETE");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const { data } = await admin.from("oferty").select("is_active").eq("id", id).single();
    expect(data?.is_active).toBe(false);
  });

  it("foreign owner DELETE → 404, victim offer still active", async () => {
    const victim = await createOwnerFixture();
    const attacker = await createOwnerFixture();
    const created = await call(offerPost, victim.jar, offerPayload());
    const { id } = (await created.json()) as { id: string };

    const response = await call(offerDelete, attacker.jar, { id }, "DELETE");
    expect(response.status).toBe(404);

    const { data } = await admin.from("oferty").select("is_active").eq("id", id).single();
    expect(data?.is_active).toBe(true);
  });
});

describe("POST /api/offer/reorder — ordering", () => {
  it("assigns sort_order by array index across the owner's offers", async () => {
    const fixture = await createOwnerFixture();
    const mk = async (nazwa: string) => {
      const r = await call(offerPost, fixture.jar, offerPayload({ nazwa }));
      return ((await r.json()) as { id: string }).id;
    };
    const id0 = await mk("A");
    const id1 = await mk("B");
    const id2 = await mk("C");

    // Reverse the order: C, B, A.
    const response = await runRoute(
      reorderPost,
      createApiContext({
        jar: fixture.jar,
        method: "POST",
        path: "/api/offer/reorder",
        body: { ids: [id2, id1, id0] },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const { data } = await admin.from("oferty").select("id, sort_order").in("id", [id0, id1, id2]);
    const order = Object.fromEntries((data ?? []).map((r) => [r.id, r.sort_order]));
    expect(order[id2]).toBe(0);
    expect(order[id1]).toBe(1);
    expect(order[id0]).toBe(2);
  });

  it("anonymous → 401", async () => {
    const response = await runRoute(
      reorderPost,
      createApiContext({ jar: new CookieJar(), method: "POST", path: "/api/offer/reorder", body: { ids: [] } }),
    );
    expect(response.status).toBe(401);
  });
});
