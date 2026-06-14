import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createAdminClient, createConfirmedOwner, seedBookingRequest, seedZagroda, uniqueEmail } from "./helpers/seed";

// Risk #4 (test-plan §2), the SSR-render half delegated to e2e (§7): teacher
// contact data (email + phone) must never leak to another owner or to an
// anonymous visitor through the rendered /dashboard/zapytania/[id] page. The
// HTTP-handler harness (tests/api/authz.test.ts) proves the API side; only a
// real browser exercises the *rendered* Astro page across middleware → cookie
// session → RLS read → SSR output, which is where this leak would surface.
//
// Two negative authorization outcomes are asserted, each as an independent,
// re-runnable test (own seed, unique owner/guest, no teardown — isolation by
// unique data, matching the project convention):
//   1. A foreign authenticated owner gets the 404 "Nie znaleziono zapytania"
//      page (RLS pre-SELECT hides the row → 404, not 403) with NO contact data.
//   2. An anonymous visitor is redirected to /auth/signin (middleware), with no
//      flash of contact data.

const OWNER_PASSWORD = "TestHaslo123!";

/**
 * A unique, attributable guest phone so an absence assertion is meaningful (a
 * leak shows this exact string). Digits are derived from the same UUID `suffix`
 * that makes the guest name/email unique — NOT an independent 6-digit random
 * (~900k space), which could collide across the never-torn-down test rows and
 * let the leak assertion pass against a different test's phone (false negative).
 */
function uniquePhone(suffix: string): string {
  const digits = BigInt(`0x${suffix}`).toString().padStart(9, "0").slice(-9);
  return `+48 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

// The /auth/signin form is a controlled React island (client:load). A value
// filled — or the submit clicked — before the island hydrates is lost: React
// resets controlled inputs to "" on hydrate and the onClick isn't attached yet.
// Astro strips the `ssr` attribute from the wrapping <astro-island> the instant
// hydration finishes, so gate the interaction on that attribute disappearing.
// This is a real-state wait, not a timer.
async function waitForIslandHydrated(field: Locator): Promise<void> {
  const unhydrated = field.page().locator("astro-island[ssr]").filter({ has: field });
  await expect(unhydrated).toHaveCount(0, { timeout: 15_000 });
}

/** Signs an owner in through the real form so @supabase/ssr writes genuine session cookies. */
async function signInOwner(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/auth/signin");
  const emailField = page.getByLabel("Email", { exact: true });
  await waitForIslandHydrated(emailField);
  await emailField.fill(email);
  // exact: avoids the "Show password" toggle, whose aria-label also contains "Password".
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

/** Seeds owner A + a published zagroda + one pending request with unique, attributable guest contact data. */
async function seedForeignRequest(
  suffix: string,
): Promise<{ requestId: string; guestEmail: string; guestPhone: string }> {
  const { userId: ownerAId } = await createConfirmedOwner(uniqueEmail("ownerA"), OWNER_PASSWORD);
  const admin = createAdminClient();
  const { zagrodaId, turnusIds } = await seedZagroda(admin, {
    ownerId: ownerAId,
    dailyLimit: 5,
    published: true,
    turnusCount: 1,
  });

  const guestEmail = uniqueEmail("guest");
  const guestPhone = uniquePhone(suffix);
  const requestId = await seedBookingRequest(admin, {
    zagrodaId,
    turnusId: turnusIds[0],
    tripDate: "2027-09-15",
    participants: 2,
    status: "pending",
    guestName: `Tajny Gosc ${suffix}`,
    guestEmail,
    guestPhone,
  });
  return { requestId, guestEmail, guestPhone };
}

test("a foreign owner sees the 404 page with no contact data, not another owner's request", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const { requestId, guestEmail, guestPhone } = await seedForeignRequest(suffix);

  // Owner B — a different, confirmed owner — signs in and tries to open owner A's request.
  const ownerBEmail = uniqueEmail("ownerB");
  await createConfirmedOwner(ownerBEmail, OWNER_PASSWORD);
  await signInOwner(page, ownerBEmail, OWNER_PASSWORD);
  await page.goto(`/dashboard/zapytania/${requestId}`);

  // RLS hides the row from a non-owner, so the page renders the 404 panel (404, not 403).
  await expect(page.getByText("Nie znaleziono zapytania")).toBeVisible();

  // The teacher contact section and A's unique email/phone appear NOWHERE in the rendered DOM.
  await expect(page.getByRole("heading", { name: "Kontakt do nauczyciela" })).toHaveCount(0);
  await expect(page.getByText(guestEmail)).toHaveCount(0);
  await expect(page.getByText(guestPhone)).toHaveCount(0);
  await expect(page.getByRole("link", { name: guestEmail })).toHaveCount(0); // no mailto:
  await expect(page.getByRole("link", { name: guestPhone })).toHaveCount(0); // no tel:
});

test("an anonymous visitor is redirected to sign-in with no flash of contact data", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const { requestId, guestEmail, guestPhone } = await seedForeignRequest(suffix);

  // The default `page` fixture carries no storageState — this context is unauthenticated.
  await page.goto(`/dashboard/zapytania/${requestId}`);

  // Middleware sends anonymous /dashboard/* traffic to sign-in before the page renders.
  await page.waitForURL("**/auth/signin**");
  await expect(page).toHaveURL(/\/auth\/signin/);

  // No contact data was rendered on the way.
  await expect(page.getByText(guestEmail)).toHaveCount(0);
  await expect(page.getByText(guestPhone)).toHaveCount(0);
});
