import { expect, test, type Locator } from "@playwright/test";
import { createConfirmedOwner, uniqueEmail } from "./helpers/seed";

// Contract gate for change topbar-account-menu.
//
// The inline Topbar e-mail was replaced by a compact account-menu island
// (AccountMenu): a fixed-width person-icon + chevron trigger that opens a
// popover holding the full e-mail and the "Wyloguj" action. This spec locks the
// user-visible behaviour: at ≥sm the bar shows only the trigger (no inline
// e-mail), clicking it reveals the e-mail, Escape and click-outside dismiss it,
// and "Wyloguj" signs the user out back to `/`.
//
// The project viewport is "Pixel 5" (~393px, `<sm`), where the account surface
// is the hamburger drawer (TopbarMobileMenu), not this island. We force a
// desktop viewport (≥sm) so AccountMenu governs the width and renders in the bar
// — the drawer variant stays in the manual checklist.
test.use({ viewport: { width: 1280, height: 800 } });

const PASSWORD = "TestHaslo123!";

// The account menu is a client:idle React island: a click before hydration is
// lost (the onClick handler isn't attached yet). Astro removes the `ssr`
// attribute from the wrapping <astro-island> the instant it finishes hydrating,
// so gate the first interaction on that attribute disappearing — a real-state
// wait, not a timer (same pattern as critical-flow.spec.ts).
async function waitForIslandHydrated(field: Locator): Promise<void> {
  const unhydrated = field.page().locator("astro-island[ssr]").filter({ has: field });
  await expect(unhydrated).toHaveCount(0, { timeout: 15_000 });
}

test("account menu: trigger reveals the e-mail, dismisses, and logs out", async ({ page }) => {
  // Isolation is by unique data (unique confirmed owner), not teardown — re-runs
  // never collide without a DB reset.
  const email = uniqueEmail("account");
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

  // The trigger carries aria-label "Menu konta: <email>" (or just "Menu konta").
  const trigger = page.getByRole("button", { name: /menu konta/i });
  await waitForIslandHydrated(trigger);
  await expect(trigger).toBeVisible();

  // Closed state: the bar shows only the trigger — the e-mail lives inside the
  // popover, which isn't rendered until opened.
  await expect(page.getByText(email)).toBeHidden();

  // Open → the full e-mail is revealed.
  await trigger.click();
  await expect(page.getByText(email)).toBeVisible();

  // Escape closes the popover (e-mail hidden again).
  await page.keyboard.press("Escape");
  await expect(page.getByText(email)).toBeHidden();

  // Re-open, then click outside the wrapper → closes. The menu is right-aligned;
  // the level-1 heading sits to the left and is a neutral, non-navigating target.
  await trigger.click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("heading", { level: 1 }).first().click();
  await expect(page.getByText(email)).toBeHidden();

  // Re-open and sign out via the popover action → native POST → redirect to `/`.
  await trigger.click();
  await page.getByRole("button", { name: "Wyloguj" }).click();
  await page.waitForURL((url) => url.pathname === "/");

  // Guest state: the account-menu trigger is gone.
  await expect(page.getByRole("button", { name: /menu konta/i })).toHaveCount(0);
});
