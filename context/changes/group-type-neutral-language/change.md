---
change_id: group-type-neutral-language
title: Typ grupy w zapytaniu + neutralny język formularza (S-11)
status: implementing
created: 2026-07-23
updated: 2026-07-23
---

## Notes

Roadmap S-11 (pakiet poprawek z feedbacku właściciela). PRD refs: FR-027, FR-029, US-04.

Gość wysyłający zapytanie wybiera typ grupy (szkoła / przedszkole / grupa indywidualna / inna), a formularz i komunikaty używają neutralnego języka („osoba kontaktowa" zamiast „nauczyciel"). Cały istniejący przepływ gościa (walidacja, mail potwierdzający z tokenem anulowania, anulowanie przed akceptacją, maile akceptacji/odrzucenia/cofnięcia) działa bez zmian (FR-029). Zmiana wyłącznie addytywna.

Decyzje planistyczne 2026-07-23:
1. `group_type` **wymagane** na formularzu gościa, bez preselekcji (pusty select, walidacja blokuje submit).
2. Kolumna **nullable** — istniejące wiersze, wpisy telefoniczne i wiersze bez typu = NULL, renderowane jako „—".
3. „inna" = tylko wartość enum, **bez pola free-text**.
4. Propagacja: panel właściciela (szczegóły + lista) **+ mail powiadomienia właściciela**. Maile do gościa (potwierdzenie, decyzje) bez zmian.
5. Formularz wpisu ręcznego (telefonicznego) właściciela dostaje **opcjonalny** selektor typu grupy (rozszerza `create_manual_booking` o `p_group_type`).
6. Neutralne słownictwo: **statyczne „osoba kontaktowa"** wszędzie (bez wariantów per typ grupy).

Enum storage tokens (ASCII, spójnie z `booking_source`/`request_status`): `szkola`, `przedszkole`, `grupa_indywidualna`, `inna`.

Plan: `plan.md`. Brief: `plan-brief.md`.
