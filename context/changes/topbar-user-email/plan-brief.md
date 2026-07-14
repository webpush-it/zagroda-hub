# Przywrócenie e-maila zalogowanego użytkownika w Topbarze — Plan Brief

> Full plan: `context/changes/topbar-user-email/plan.md`

## What & Why

Zalogowany użytkownik nie widzi, na jakie konto jest zalogowany — brakuje adresu e-mail w Topbarze. Element ten był tam od początku (`1b18c06`), ale wypadł przy migracji UI na motyw „Łąka i miód" (`6c29252`, 2026-07-12) i nigdy nie wrócił. Przywracamy go dla kontekstu konta i zaufania.

## Starting Point

`Topbar.astro` czyta `Astro.locals.user`, renderuje logo, desktopową grupę linków + „Wyloguj" (`hidden … sm:flex`) oraz wyspę React `TopbarMobileMenu` (drawer, `<sm`). Żadna z tych powierzchni nie pokazuje `user.email`. Typ `user` (Supabase `User`) ma `email?: string` — może być `undefined`.

## Desired End State

Zalogowany user widzi swój e-mail: na desktopie jako wyszarzony, skrócony tekst tuż przed „Wyloguj"; na mobile w nagłówku otwartego drawera. Gdy e-mail jest `undefined` — element pomijany. Gość nie widzi nic nowego.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Source |
| --- | --- | --- | --- |
| Gdzie pokazać | Desktop inline + drawer mobilny | Spójny kontekst konta na obu szerokościach | Plan |
| Wygląd desktop | Wyszarzony, przy „Wyloguj" | Naturalne powiązanie konto→wyloguj, zgodne z układem justify-between | Plan |
| Brak e-maila | Nie renderować | Zero pustego/mylącego tekstu; najbezpieczniej | Plan |
| Test e2e | Mały guard (seed+login → asercja) | Chroni przed powtórką cichej regresji | Plan |

## Scope

**In scope:** e-mail w desktopowym pasku (przy „Wyloguj"), e-mail w nagłówku drawera (nowy prop `userEmail`), render warunkowy, truncate długiego adresu, lekki test e2e.

**Out of scope:** menu/dropdown konta, zmiany `links`/`signOutAction`, cokolwiek dla gościa, zmiany auth/middleware/PageShell/stron auth, zmiany focus-trapa/scroll-locka drawera.

## Architecture / Approach

Faza 1 — prezentacja: warunkowy `<span>` z e-mailem w `Topbar.astro` (desktop) + rozszerzenie propsów `TopbarMobileMenu` o `userEmail` i render w nagłówku drawera; e-mail przekazywany z `Astro.locals.user.email`. Faza 2 — guard e2e: seed confirmed usera (`e2e/helpers/seed.ts`), login przez UI (wzorzec z `critical-flow.spec.ts`), asercja widoczności e-maila na `/dashboard` przy wymuszonym viewporcie desktop; pełne gate'y zielone.

## Phases at a Glance

| Faza | Dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. E-mail w Topbarze | E-mail na desktopie (inline) i mobile (drawer), warunkowy | Długi e-mail → overflow @320 (mitygacja: truncate/max-w + gate mobile-320) |
| 2. E2E guard + weryfikacja | Test chroniący widoczność e-maila + zielone gate'y | Flaky login/hydratacja (mitygacja: desktop viewport, real-state waits) |

**Prerequisites:** lokalny stack Supabase (`npm run db:start`) do e2e; brak zależności zewnętrznych.
**Estimated effort:** ~1 sesja, 2 fazy.

## Open Risks & Assumptions

- `user.email` bywa `undefined` (część OAuth) — render warunkowy to pokrywa.
- Domyślny projekt Playwright to Pixel 5 (`<sm`); test wymusza desktop viewport, by asertować inline bez zależności od hydratacji drawera.

## Success Criteria (Summary)

- Zalogowany user widzi swój e-mail w Topbarze (desktop i mobile); gość nie.
- Brak horizontal scroll @320 z długim e-mailem; istniejące gate'y zielone.
- Nowy test e2e mechanicznie chroni przed ponownym wypadnięciem e-maila.
