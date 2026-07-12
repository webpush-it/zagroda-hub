import { randomUUID } from "node:crypto";
import { expect, test, type Locator } from "@playwright/test";
import { createAdminClient, createConfirmedOwner, seedBookingRequest, seedZagroda, uniqueEmail } from "./helpers/seed";

// Risk #3 (test-plan §2): a critical mobile flow — guest request → owner accept
// → overbooking block — breaks in UI/middleware/handler wiring while CI stays
// green, because nothing above the DB layer is exercised. This is the only
// layer that proves the whole chain (public form → /api/booking-request → DB →
// owner auth → dashboard → /api/booking-request/accept → SECURITY DEFINER RPC →
// rendered blocked panel) integrates. Seed shapes mirror tests/helpers (see
// e2e/helpers/seed.ts); the capacity oracle is the PRD (FR-014), not handler code.
//
// Isolation is by unique data, not teardown: each run creates a fresh owner +
// zagroda (unique email) and unique guests, so re-runs never collide without a
// DB reset.

const OWNER_PASSWORD = "TestHaslo123!";

/** A real future date (>= today) in YYYY-MM-DD, randomised so seeded rows stay attributable. */
function uniqueFutureDate(): string {
  const offsetDays = 1 + Math.floor(Math.random() * 900);
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// The forms here are controlled React islands (client:load). A value filled — or a
// button clicked — before the island hydrates is lost: React resets controlled
// inputs to "" on hydrate, and the onClick handler isn't attached yet. Astro removes
// the `ssr` attribute from the wrapping <astro-island> the instant it finishes
// hydrating (astro/dist/runtime/server/astro-island.js:189), so gate every island
// interaction on that attribute disappearing. This is a real-state wait, not a timer.
async function waitForIslandHydrated(field: Locator): Promise<void> {
  const unhydrated = field.page().locator("astro-island[ssr]").filter({ has: field });
  await expect(unhydrated).toHaveCount(0, { timeout: 15_000 });
}

test("guest request → owner accept fills the single seat → second accept is blocked at the daily limit", async ({
  page,
}) => {
  test.setTimeout(60_000); // four SSR page loads + sign-in + two accepts against a cold workerd

  // --- Seed: confirmed owner, published zagroda (daily_limit 1, one turnus), and
  // a SECOND pending request on the same date/turnus so the arena is full after
  // one accept. The guest's OWN request (the first) is created through the UI below.
  const suffix = randomUUID().slice(0, 8);
  const ownerEmail = uniqueEmail("owner");
  const { userId: ownerId } = await createConfirmedOwner(ownerEmail, OWNER_PASSWORD);

  const admin = createAdminClient();
  const { zagrodaId, turnusIds } = await seedZagroda(admin, {
    ownerId,
    dailyLimit: 1,
    published: true,
    turnusCount: 1,
  });
  const turnusId = turnusIds[0];
  const tripDate = uniqueFutureDate();

  const guest1Name = `Pierwszy Gosc ${suffix}`;
  const guest1Email = uniqueEmail("guest1");
  const guest2Name = `Blokowany Gosc ${suffix}`;
  const guest2Email = uniqueEmail("guest2");

  await seedBookingRequest(admin, {
    zagrodaId,
    turnusId,
    tripDate,
    participants: 1,
    status: "pending",
    guestName: guest2Name,
    guestEmail: guest2Email,
    guestPhone: "+48 600 100 200",
  });

  // --- Step 1: guest submits a booking request through the public form.
  await page.goto(`/zagrody/${zagrodaId}`);
  const turnus = page.getByLabel("Turnus", { exact: true });
  await waitForIslandHydrated(turnus);
  await turnus.selectOption(turnusId);
  await page.getByLabel("Data pobytu").fill(tripDate);
  await page.getByLabel("Liczba uczestników").fill("1");
  await page.getByLabel("Imię i nazwisko").fill(guest1Name);
  await page.getByLabel("E-mail").fill(guest1Email);
  await page.getByLabel("Telefon").fill("+48 600 200 300");
  await page.getByRole("button", { name: "Wyślij zapytanie" }).click();

  // Success swaps the form in-place for a green panel — no navigation.
  await expect(page.getByText("Zapytanie wysłane — sprawdź e-mail")).toBeVisible();

  // --- Step 2: owner signs in via the real form (genuine @supabase/ssr cookies).
  await page.goto("/auth/signin");
  const emailField = page.getByLabel("E-mail", { exact: true });
  await waitForIslandHydrated(emailField);
  await emailField.fill(ownerEmail);
  // exact: avoids the "Pokaż hasło" toggle, whose aria-label also contains "hasło".
  await page.getByLabel("Hasło", { exact: true }).fill(OWNER_PASSWORD);
  // role=button disambiguates from the Topbar "Zaloguj się" link, which shares the copy.
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await page.waitForURL("**/dashboard");

  // --- Step 3: accept the guest's request — fills the single seat.
  await page.goto("/dashboard/zapytania");
  await page.getByRole("link", { name: guest1Name }).click();
  await page.waitForURL("**/dashboard/zapytania/**");
  const akceptuj1 = page.getByRole("button", { name: "Akceptuj", exact: true });
  await waitForIslandHydrated(akceptuj1);
  await akceptuj1.click();
  await expect(page.getByText("Zaakceptowano — nauczyciel dostanie e-mail")).toBeVisible();

  // --- Step 4: accept the second request — must be blocked at the daily limit
  // with the exact PRD-derived capacity message, and the request stays pending.
  await page.goto("/dashboard/zapytania");
  await page.getByRole("link", { name: guest2Name }).click();
  await page.waitForURL("**/dashboard/zapytania/**");
  const akceptuj2 = page.getByRole("button", { name: "Akceptuj", exact: true });
  await waitForIslandHydrated(akceptuj2);
  await akceptuj2.click();

  // Oracle is PRD FR-014: "Limit dzienny przekroczony (X z Y zajęte, Z wymaga miejsca)"
  // — with daily_limit 1 + one accepted participant: (1 z 1 zajęte, 1 wymaga miejsca).
  await expect(page.getByText("Limit dzienny przekroczony (1 z 1 zajęte, 1 wymaga miejsca)")).toBeVisible();
  // The blocked request is NOT accepted — it stays pending. Both assertions are
  // scoped to guest2's single-request detail page: the status badge still reads
  // "Oczekujące", and the decision buttons remain (RequestDecision only renders
  // them while status === "pending"), so the seat is still claimable. The button
  // check binds the pending state to *this* request, not just any page text.
  await expect(page.getByText("Oczekujące", { exact: true })).toBeVisible();
  await expect(akceptuj2).toBeVisible();
});
