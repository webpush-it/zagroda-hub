---
change_id: landing-enrichment
title: Wzbogacenie landing page (klient-first) wg najlepszych praktyk
status: archived
created: 2026-07-20
updated: 2026-07-20
archived_at: 2026-07-20T17:15:31Z
---

## Notes

Kontynuacja slice'u S-09 (`client-first-landing`, zamknięty/implemented). Obecny landing (`src/pages/index.astro`) jest „zbyt ubogi" — niemal sam wyśrodkowany tekst, jedna karta, jeden kolor akcentu, zero ilustracji/ikon/trust-signali/FAQ. Cel: wzbogacić stronę klient-first wg najlepszych praktyk landing page'ów.

Twarde ograniczenia (z rundy research): (1) tylko funkcje dostępne dziś — browse katalogu z filtrami, zapytanie bez konta, gwarancja anty-overbooking; BEZ obietnic geolokalizacji/nearest (S-10), cen (S-12), filtrów temat/adresaci (S-13); (2) tylko istniejące zasoby marki — `bg-meadow`, `ZagrodaPlaceholder`, ikony jako inline SVG (bez React-island), tokeny „Łąka i miód"; bez nowej fotografii; (3) brak fałszywego social proof — jeden realny właściciel-tester, recenzje to non-goal → tylko uczciwe sygnały (gwarancja, prywatność kontaktu, „bez konta"); sieć zagród tylko jako kotwica kategorii, nie partnerstwo.

Wiążące (NIE otwierać): klient-first, brak rewersu do owner-first, podaż kanałami bezpośrednimi (nie przez landing), motyw „Łąka i miód", jeden `<h1>`, `PageShell width="wide"`.

Uwaga load-bearing: `e2e/desktop-width.spec.ts:26` już asertuje STARY owner-first H1 (rozjazd od `dbf5563`); CI nie uruchamia e2e. Każda zmiana H1 musi zaktualizować ten spec — najlepiej naprawić od razu.

Research (pełna analiza luk + specyfikacja sekcja-po-sekcji + sugerowane 3 fazy): `context/changes/client-first-landing/research.md`.
