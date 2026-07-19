---
change_id: phone-bookings-and-day-blocks
title: Wpisy telefoniczne, blokady dni i źródło rezerwacji (S-08, gwiazda przewodnia)
status: plan_reviewed
created: 2026-07-19
updated: 2026-07-19
---

## Notes

Roadmap S-08 (gwiazda przewodnia pakietu poprawek z feedbacku właściciela). PRD refs: FR-021, FR-022, FR-023, FR-028, FR-031, US-03.

Właściciel dodaje ręczną rezerwację telefoniczną (data, turnus, liczba uczestników, opcjonalna notatka) oraz blokuje/odblokowuje cały dzień; oba kanały objęte tą samą gwarancją anty-overbooking („dokładnie jeden sukces" pod współbieżnością); usunięcie wpisu/blokady natychmiast zwalnia miejsca; źródło rezerwacji (aplikacja/telefon) widoczne w panelu.

Decyzje sesji planistycznej 2026-07-19 (wszystkie w `plan-brief.md` → Key Decisions): rozszerzenie `booking_requests` (nie osobna tabela), blokada nie rusza oczekujących zapytań, blokada dozwolona przy istniejących rezerwacjach, soft-delete wpisu (status flip), UI na `/dashboard/zapytania`.

Plan: `plan.md`. Brief: `plan-brief.md`.
