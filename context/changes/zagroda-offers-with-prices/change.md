---
change_id: zagroda-offers-with-prices
title: Oferty zagrody z cenami (S-12)
status: implementing
created: 2026-07-23
updated: 2026-07-23
archived_at: null
---

## Notes

Roadmap slice **S-12** (Change ID `zagroda-offers-with-prices`). PRD refs: FR-024, FR-025, FR-031, US-04.

**Outcome:** właściciel może dodać, edytować i usunąć oferty swojej zagrody (nazwa, opis, czas trwania, adresaci, temat warsztatów, opcjonalna cena), a gość widzi na stronie zagrody listę ofert z cenami lub „cena ustalana indywidualnie"; zagrody bez ofert pozostają w pełni funkcjonalne (pusta sekcja, nie błąd), a oferty są edytowalne wyłącznie przez właściciela tej zagrody. Zmiana wyłącznie addytywna — istniejące zagrody bez ofert nie mogą się zepsuć w katalogu.

**Framing rozstrzygnięty 2026-07-23** (`/10x-frame` → `frame.md`, confidence MEDIUM):
1. **Jednostka ceny:** właściciel wybiera per oferta → enum `price_unit` (`za_osobe`/`za_grupe`) + opcjonalna kwota. (PRD Open Q#2 — ROZSTRZYGNIĘTE.)
2. **Zakres oferty:** **tylko wyświetlanie** (katalog na stronie zagrody) — bez FK do `booking_requests`, przepływ gościa (FR-029) nietknięty.
3. **Taksonomia temat/adresaci:** decyzja = **zdefiniować pełną listę teraz** (nie free-text) → pola formularza oparte o enum/słownik.

⏳ **Prerekwizyt przed `/10x-plan` (user gathering):** lista wartości „temat warsztatów" + „adresaci" wzorowana na katalogu Ogólnopolskiej Sieci Zagród Edukacyjnych, potwierdzona z właścicielem-doradcą (PRD Open Q#1). Po jej zebraniu confidence → HIGH i slice jest w pełni planowalny.
