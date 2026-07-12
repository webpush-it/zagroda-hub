import { expect, test, type Locator } from "@playwright/test";

// Regression gate for the 320px mobile floor (change: fix-mobile-ui-bugs).
//
// The project viewport is "Pixel 5" (~393px); we override to 320px at the FILE
// level so this spec proves the narrow floor the redesign never validated. No
// seeding — only public, SSR surfaces reachable without login (mirrors
// smoke.spec.ts). Authed surfaces (dashboard, RequestsList, TurnusyEditor,
// zapytania) stay in the manual checklist (manual-320-checklist.md), and
// engine-rendered clipping of native date/time controls likewise stays manual
// (Chrome + Firefox).
//
// Beyond overflow (bug class D1) the spec also guards tap-target height (D3/D4)
// and password-field right reserve (D5), so a future edit that drops the
// `tap-target` utility or the password `pr-10` reserve fails here, not just a
// horizontal-scroll regression.
test.use({ viewport: { width: 320, height: 640 } });

const PUBLIC_PAGES = ["/", "/katalog", "/auth/signin", "/auth/signup"];

// The hamburger island hydrates on `client:idle`; its SSR markup is present
// immediately but the click handler is not attached until Astro removes the
// `ssr` attribute from the wrapping <astro-island>. Gate interaction on that
// (a real-state wait, not a timer — same pattern as critical-flow.spec.ts).
async function waitForIslandHydrated(el: Locator): Promise<void> {
  const unhydrated = el.page().locator("astro-island[ssr]").filter({ has: el });
  await expect(unhydrated).toHaveCount(0, { timeout: 15_000 });
}

for (const path of PUBLIC_PAGES) {
  test(`@320 no horizontal page overflow on ${path}`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);

    // The page floor: the document must not scroll horizontally at 320px.
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
}

test("@320 tap-targets: hamburger button and a drawer nav link are ≥44px", async ({ page }) => {
  await page.goto("/katalog");

  // Hamburger is `sm:hidden` → visible at 320px. Its `tap-target` utility must
  // give a ≥44px (2.75rem) hit height.
  const hamburger = page.getByRole("button", { name: "Menu nawigacji" });
  await expect(hamburger).toBeVisible();
  const hamburgerBox = await hamburger.boundingBox();
  expect(hamburgerBox?.height).toBeGreaterThanOrEqual(44);

  // A nav link only exists once the drawer opens — wait for hydration, open it,
  // then assert the same tap-target floor on a real standalone link.
  await waitForIslandHydrated(hamburger);
  await hamburger.click();
  const drawer = page.locator("#topbar-mobile-drawer");
  await expect(drawer).toBeVisible();
  const navLink = drawer.getByRole("link").first();
  await expect(navLink).toBeVisible();
  const navLinkBox = await navLink.boundingBox();
  expect(navLinkBox?.height).toBeGreaterThanOrEqual(44);
});

test("@320 password field reserves right padding for the toggle", async ({ page }) => {
  await page.goto("/auth/signin");

  // exact: the input's label is "Hasło"; the PasswordToggle's aria-label also
  // contains "hasło", so an inexact match would be ambiguous.
  const passwordInput = page.getByLabel("Hasło", { exact: true });
  await expect(passwordInput).toBeVisible();

  // `pr-10!` (2.5rem) must survive so typed text never slides under the eye
  // icon. Assert ≥2.25rem (36px) to allow a small future tweak without masking
  // a dropped reserve.
  const paddingRight = await passwordInput.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));
  expect(paddingRight).toBeGreaterThanOrEqual(36);
});
