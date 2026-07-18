import { expect, test, type Page } from "@playwright/test";

// Desktop width-contract gate (change: refactor-responsive-web-design).
//
// mobile-320.spec.ts proves the narrow floor; this spec proves the WIDE end of
// the new PageShell width contract on a 1280px desktop viewport. It exists to
// offset the weakened single-device (Pixel 5) justification: the migration
// deliberately widens `default`/`wide` columns on lg/xl, so a desktop assertion
// that each variant caps AND centers its content column is what keeps that
// choice honest. No seeding — all three representatives are public SSR surfaces
// reachable without login: `/katalog` (default — `/dashboard` shares the variant
// but is a PROTECTED_ROUTE that redirects guests, so the public catalog stands
// in), `/` (wide), `/auth/signin` (narrow + center).
//
// Anchoring uses getByRole(heading); the column GEOMETRY is read via
// getBoundingClientRect in the browser, because PageShell's `mx-auto w-full
// max-w-*` column is a pure layout div with no semantic role to target.
test.use({ viewport: { width: 1280, height: 800 } });

// Tailwind caps (px) for each PageShell variant at this viewport:
//   default → lg:max-w-2xl = 42rem = 672
//   wide    → xl:max-w-6xl = 72rem = 1152
//   narrow  → max-w-sm     = 24rem = 384
const VARIANTS = [
  { path: "/katalog", heading: "Katalog zagród", cap: 672 },
  { path: "/", heading: "Rezerwacje wycieczek do Twojej zagrody — w jednym miejscu, prosto z telefonu.", cap: 1152 },
  { path: "/auth/signin", heading: "Zaloguj się", cap: 384 },
] as const;

interface ColumnRect {
  left: number;
  right: number;
  width: number;
  viewport: number;
}

// The width-contract element is the single direct child of the `bg-meadow`
// shell wrapper — PageShell's `mx-auto w-full max-w-*` column. Reading its rect
// lets us assert both the variant cap and left≈right centering in one shot.
async function columnRect(page: Page): Promise<ColumnRect | null> {
  return page.evaluate(() => {
    const shell = document.querySelector(".bg-meadow");
    const col = shell?.firstElementChild;
    if (!col) return null;
    const r = col.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, viewport: document.documentElement.clientWidth };
  });
}

for (const { path, heading, cap } of VARIANTS) {
  test(`@1280 ${path} caps and centers its content column`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();

    // No horizontal overflow at desktop width (mirrors the mobile-320 floor).
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    const rect = await columnRect(page);
    expect(rect).not.toBeNull();
    if (rect === null) throw new Error("PageShell content column not found under .bg-meadow");

    // Column width must not exceed the variant cap (1px sub-pixel tolerance).
    expect(rect.width).toBeLessThanOrEqual(cap + 1);
    // …and must actually reach it — a cap that silently collapsed (e.g. the
    // lg/xl step dropped) would leave the column far narrower than intended.
    expect(rect.width).toBeGreaterThanOrEqual(cap - 1);

    // Centered: left margin ≈ right margin (the gutter is symmetric px-*).
    const rightMargin = rect.viewport - rect.right;
    expect(Math.abs(rect.left - rightMargin)).toBeLessThanOrEqual(2);
  });
}

// Brand-header contract on auth (change: auth-brand-header). Auth pages carry no
// Topbar, so PageShell's optional `brand` prop restores a single logo-link to `/`
// (trust + escape hatch) WITHOUT bringing nav back. This locks both halves at
// once so neither can silently regress: the brand-link must exist, and Topbar
// nav must stay absent. `/auth/signin` stands in for all 5 auth surfaces (they
// share the same PageShell contract).
test("@1280 /auth/signin has the brand-link to / but no Topbar nav", async ({ page }) => {
  await page.goto("/auth/signin");

  // Brand-link: the logo wraps in an <a href="/"> mirroring Topbar's brand-link
  // pattern (same aria-label). It must be visible and point at the home route.
  const brandLink = page.getByRole("link", { name: "Zagroda Hub — strona główna" });
  await expect(brandLink).toBeVisible();
  await expect(brandLink).toHaveAttribute("href", "/");

  // No Topbar nav. "Katalog" is the discriminator BECAUSE it is rendered ONLY by
  // Topbar — "Zaloguj się"/"Zarejestruj się" also appear as cross-links between
  // auth pages, so they can't prove Topbar's absence. Zero "Katalog" links means
  // no Topbar leaked back onto auth.
  await expect(page.getByRole("link", { name: "Katalog" })).toHaveCount(0);
});
