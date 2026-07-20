---
change_id: client-first-landing
title: Landing klient-first — „Znajdź zagrodę" na środku (S-09)
status: implemented
created: 2026-07-19
updated: 2026-07-20
research: research.md
---

## Notes

Roadmap S-09 (pakiet poprawek z feedbacku właściciela). PRD refs: FR-019, US-04.

Odwrócenie strony głównej z owner-first na klient-first: powitanie + centralne CTA „Znajdź zagrodę" (→ `/katalog`) + krótki blurb dla szukającego, skonsolidowana sekcja „Prowadzisz zagrodę?" niżej z własnym CTA, logowanie/rejestracja na dole strony; dodatkowo promocja linku „Katalog" w topbarze do przycisku CTA „Znajdź zagrodę" dla gościa. Czysto prezentacyjne — bez zmian danych/API/tras. Geolokalizacja i sortowanie po odległości to osobny slice S-10.

Decyzje planistyczne 2026-07-19: (1) skonsolidować treść ownera w jedną sekcję; (2) hero = CTA + krótki blurb; (3) klient-first dla wszystkich, zalogowany właściciel dostaje „Przejdź do panelu" w sekcji ownera; (4) promocja CTA w topbarze (guest payload).

Plan: `plan.md`. Brief: `plan-brief.md`.
