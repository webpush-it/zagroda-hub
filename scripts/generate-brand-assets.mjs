/**
 * Generuje rastrowe assety brandu z autorskich SVG:
 *   - public/favicon.png (32×32) z public/favicon.svg
 *   - public/og-image.png (1200×630) z inline-SVG (logomark + wordmark + tagline)
 *
 * Uruchomienie: node scripts/generate-brand-assets.mjs
 * Wygenerowane PNG commitujemy do repo. Fonty do renderu tekstu OG leżą
 * w scripts/fonts/ (statyczne instancje Nunito 400/800, licencja OFL obok).
 */
import console from "node:console";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fontFiles = [
  join(root, "scripts/fonts/nunito-400-subset.ttf"),
  join(root, "scripts/fonts/nunito-800-subset.ttf"),
];

// --- favicon.png (32×32) ---
const faviconSvg = readFileSync(join(root, "public/favicon.svg"), "utf8");
const favicon = new Resvg(faviconSvg, {
  fitTo: { mode: "width", value: 32 },
});
writeFileSync(join(root, "public/favicon.png"), favicon.render().asPng());
console.log("✓ public/favicon.png (32×32)");

// --- og-image.png (1200×630) ---
const mark = `
  <circle cx="35" cy="13" r="8" fill="#D98E2B"/>
  <path d="M9 42V24L14 15L24 11L34 15L39 24V42H9Z" fill="#3F7D2C"/>
  <path d="M20 42V34C20 31.79 21.79 30 24 30C26.21 30 28 31.79 28 34V42H20Z" fill="#F7F5EF"/>
`;

const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F7F5EF"/>
  <rect width="1200" height="12" y="618" fill="#3F7D2C"/>
  <g transform="translate(510, 96) scale(3.75)">${mark}</g>
  <text x="600" y="418" text-anchor="middle" font-family="Nunito" font-weight="800" font-size="88" fill="#27301F">Zagroda Hub</text>
  <text x="600" y="496" text-anchor="middle" font-family="Nunito" font-weight="400" font-size="36" fill="#5B6350">Wycieczki szkolne do zagród edukacyjnych</text>
</svg>`;

const og = new Resvg(ogSvg, {
  font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Nunito" },
});
writeFileSync(join(root, "public/og-image.png"), og.render().asPng());
console.log("✓ public/og-image.png (1200×630)");
