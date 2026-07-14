import { expect, test, type Locator } from "@playwright/test";
import { createConfirmedOwner, uniqueEmail } from "./helpers/seed";

// Regression gate for change topbar-user-email.
//
// The logged-in user's e-mail was visible in the Topbar from init (1b18c06) but
// silently fell out during the "Łąka i miód" UI migration (6c29252) and stayed
// gone through later Topbar work. This spec locks the restored behaviour so the
// exact regression that already happened once can't happen again: after a real
// sign-in, the user's e-mail must be visible in the Topbar on an app page.
//
// The project viewport is "Pixel 5" (~393px, `<sm`), where the e-mail lives in
// the mobile drawer and only appears after the island hydrates. We deliberately
// force a desktop viewport (≥sm) so the e-mail renders inline in the bar — a
// deterministic assertion with no dependency on drawer-island hydration. The
// @320 drawer variant + long-e-mail overflow stay in the manual checklist and
// are covered geometrically by mobile-320.spec.ts.
test.use({ viewport: { width: 1280, height: 800 } });

const PASSWORD = "TestHaslo123!";

// The sign-in form is a controlled React island (client:load): a value filled
// before hydration is lost (React resets controlled inputs to "" on hydrate).
// Astro removes the `ssr` attribute from the wrapping <astro-island> the instant
// it finishes hydrating, so gate the fill on that attribute disappearing — a
// real-state wait, not a timer (same pattern as critical-flow.spec.ts).
async function waitForIslandHydrated(field: Locator): Promise<void> {
  const unhydrated = field.page().locator("astro-island[ssr]").filter({ has: field });
  await expect(unhydrated).toHaveCount(0, { timeout: 15_000 });
}

test("logged-in user sees their e-mail in the Topbar on an app page", async ({ page }) => {
  // Isolation is by unique data (unique confirmed owner), not teardown — re-runs
  // never collide without a DB reset.
  const email = uniqueEmail("user");
  await createConfirmedOwner(email, PASSWORD);

  // Sign in through the real form for genuine @supabase/ssr cookies.
  await page.goto("/auth/signin");
  const emailField = page.getByLabel("E-mail", { exact: true });
  await waitForIslandHydrated(emailField);
  await emailField.fill(email);
  // exact: avoids the "Pokaż hasło" toggle, whose aria-label also contains "hasło".
  await page.getByLabel("Hasło", { exact: true }).fill(PASSWORD);
  // role=button disambiguates from the Topbar "Zaloguj się" link, which shares the copy.
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await page.waitForURL("**/dashboard");

  // /dashboard carries the Topbar; at ≥sm the e-mail renders inline (before the
  // "Wyloguj" action). Its presence proves the restored behaviour.
  await expect(page.getByText(email)).toBeVisible();
});
