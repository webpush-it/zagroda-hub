---
change_id: nearest-zagrody-sort
title: Najbliższe zagrody — sortowanie katalogu po odległości od gościa (S-10)
status: implementing
created: 2026-07-20
updated: 2026-07-20
archived_at: null
---

## Notes

Slice S-10 z roadmapy (`nearest-zagrody-sort`, ready). Outcome: gość, który udostępni lokalizację urządzenia, widzi katalog posortowany rosnąco po odległości od siebie, z przybliżoną odległością (dokładność na poziomie miejscowości) na każdej karcie; odmowa lokalizacji zostawia katalog dokładnie w obecnym kształcie (filtry województwo/miasto), bez błędów i bez ponawiania prośby; sortowanie współpracuje z istniejącymi filtrami, a lokalizacja gościa nie jest utrwalana.

PRD refs: FR-020, FR-030, US-04. NFR: katalog < 2 s p95; lokalizacja nieutrwalana; odległość jawnie przybliżona.

Unknown do domknięcia w `/10x-plan`: mechanizm wyznaczania współrzędnych miejscowości (słownik lokalny vs zewnętrzne API geokodowania) — bez nowych pól dla właściciela, dokładność miejscowości, auto-uzupełnienie istniejących zagród.

Kontekst: kontynuacja pakietu S-09 (`client-first-landing`, `landing-enrichment` — zarchiwizowane). Razem z S-09 domyka kryterium sukcesu #2 („maksymalnie 2 interakcje od strony głównej do katalogu od najbliższych"). Najmocniej akcentowany pomysł właściciela.
