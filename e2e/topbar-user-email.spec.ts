import { expect, test, type Locator, type Page } from "@playwright/test";
import { createConfirmedOwner, uniqueEmail } from "./helpers/seed";

// Regression gate for change topbar-user-email.
//
// The logged-in user's e-mail was visible in the Topbar from init (1b18c06) but
// silently fell out during the "Łąka i miód" UI migration (6c29252) and stayed
// gone through later Topbar work. This spec locks the restored behaviour so the
// exact regression that already happened once can't happen again: after a real
// sign-in, the user's e-mail must be visible in the Topbar on an app page.
//
// Two guards:
//   1. @1280 — the inline e-mail renders in the desktop bar. The project
//      viewport is "Pixel 5" (~393px, `<sm`), where the e-mail lives in the
//      mobile drawer and only appears after the island hydrates; we force a
//      desktop viewport so the assertion is deterministic (no drawer-island
//      hydration dependency).
//   2. @700 — the inline-floor band (just above the `sm` 640px breakpoint, where
//      logo + links + e-mail + "Wyloguj" are most cramped). A LONG e-mail here
//      must truncate and stay inside the bar, NOT overflow the header. This is
//      the exact bug that shipped once (inline e-mail overflowed at ~640–900px
//      because the flex child lacked `min-w-0`, so `truncate` never engaged) —
//      the fix adds `min-w-0` to the inline group + e-mail span.
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

// Sign in through the real form for genuine @supabase/ssr cookies; lands on /dashboard.
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/auth/signin");
  const emailField = page.getByLabel("E-mail", { exact: true });
  await waitForIslandHydrated(emailField);
  await emailField.fill(email);
  // exact: avoids the "Pokaż hasło" toggle, whose aria-label also contains "hasło".
  await page.getByLabel("Hasło", { exact: true }).fill(PASSWORD);
  // role=button disambiguates from the Topbar "Zaloguj się" link, which shares the copy.
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await page.waitForURL("**/dashboard");
}

test("logged-in user sees their e-mail in the Topbar on an app page", async ({ page }) => {
  // Isolation is by unique data (unique confirmed owner), not teardown — re-runs
  // never collide without a DB reset.
  const email = uniqueEmail("user");
  await createConfirmedOwner(email, PASSWORD);
  await signIn(page, email);

  // /dashboard carries the Topbar; at ≥sm the e-mail renders inline (before the
  // "Wyloguj" action). Its presence proves the restored behaviour.
  await expect(page.getByText(email)).toBeVisible();
});

test("@700 long inline e-mail truncates and does not overflow the header", async ({ page }) => {
  // Deliberately long local-part to stress the inline-floor band. Before the
  // min-w-0 fix, this overflowed the bar at ~640–900px because the flex child
  // could not shrink below its (single-token) min-content, so truncate never
  // clipped it.
  const email = uniqueEmail("bardzo-dlugi-adres-email-uzytkownika-do-testu-przepelnienia-paska");
  await createConfirmedOwner(email, PASSWORD);
  await signIn(page, email);

  // Just above the sm (640px) breakpoint, where the inline group is tightest.
  await page.setViewportSize({ width: 700, height: 800 });

  // The e-mail node is present (truncated), and the document must not scroll
  // horizontally — the header contains the e-mail instead of spilling past it.
  await expect(page.getByText(email)).toBeVisible();
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});
