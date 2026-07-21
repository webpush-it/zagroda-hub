---
change_id: nearest-zagrody-sort
title: Najbliższe zagrody — sortowanie katalogu po odległości od gościa (S-10)
status: impl_reviewed
created: 2026-07-20
updated: 2026-07-21
archived_at: null
---

## Notes

Slice S-10 z roadmapy (`nearest-zagrody-sort`, ready). Outcome: gość, który udostępni lokalizację urządzenia, widzi katalog posortowany rosnąco po odległości od siebie, z przybliżoną odległością (dokładność na poziomie miejscowości) na każdej karcie; odmowa lokalizacji zostawia katalog dokładnie w obecnym kształcie (filtry województwo/miasto), bez błędów i bez ponawiania prośby; sortowanie współpracuje z istniejącymi filtrami, a lokalizacja gościa nie jest utrwalana.

PRD refs: FR-020, FR-030, US-04. NFR: katalog < 2 s p95; lokalizacja nieutrwalana; odległość jawnie przybliżona.

Unknown do domknięcia w `/10x-plan`: mechanizm wyznaczania współrzędnych miejscowości (słownik lokalny vs zewnętrzne API geokodowania) — bez nowych pól dla właściciela, dokładność miejscowości, auto-uzupełnienie istniejących zagród.

Kontekst: kontynuacja pakietu S-09 (`client-first-landing`, `landing-enrichment` — zarchiwizowane). Razem z S-09 domyka kryterium sukcesu #2 („maksymalnie 2 interakcje od strony głównej do katalogu od najbliższych"). Najmocniej akcentowany pomysł właściciela.

## Deploy / seed runbook (Faza 2)

Kolejność deployu (spójna z regułą `lessons.md`: migracje przed workerem): **`db:push` → `db:seed-localities` → `wrangler deploy`**. `npm run deploy` wywołuje te kroki po kolei (`npm run build && db:push && db:seed-localities && wrangler deploy`). Lokalnie: po `npm run db:reset` uruchom `npm run db:seed-localities`. Skrypt jest idempotentny i re-runnable (upsert `on conflict` + set-owy backfill), więc bezpiecznie biegnie przy każdym deployu.

Prod wymaga `SUPABASE_DB_URL` w env (skrypt łączy się `pg`-iem); lokalnie skrypt sam odczyta `DB_URL` z `supabase status`. Próg jakości: match-rate ≥ 90% opublikowanych zagród — poniżej progu skrypt kończy się kodem ≠ 0 i zrzuca listę nietrafionych `(voivodeship, city)` do remediacji (override: `ALLOW_LOW_MATCH=1`).

Źródło datasetu: GUGiK **PRNG — miejscowości** (dane.gov.pl dataset 780, zasób 30102). Licencja to **CC BY 4.0 / PZGiK** (nie „domena publiczna", jak zakładał research/plan) — swobodne użycie z wymaganą atrybucją PZGiK; szczegóły i kroki regeneracji w `scripts/data/README.md`.
