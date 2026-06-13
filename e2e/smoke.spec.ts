import { expect, test } from "@playwright/test";

// De-risking checkpoint for the whole harness: prove the BUILT Worker serves
// under `wrangler dev` (workerd) with live env, independent of any domain flow.
// No seeding. The catalog is a public, SSR, Supabase-backed page — a 200 + its
// stable heading confirms build → wrangler dev → workerd → SSR works end to end.
// (Whether real catalog rows render — i.e. Supabase env reached the Worker — is
// the human manual-verification step, since a freshly reset DB has no data.)

test("built Worker serves the catalog page (SSR smoke)", async ({ page }) => {
  const response = await page.goto("/katalog");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Katalog zagród" })).toBeVisible();
});
