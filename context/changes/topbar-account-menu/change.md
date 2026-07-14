---
change_id: topbar-account-menu
title: Menu konta w Topbarze zamiast inline e-maila
status: implemented
created: 2026-07-15
updated: 2026-07-15
archived_at: null
---

## Notes

Wyodrębnione z pracy nad `topbar-user-email` (zarchiwizowana). Inline e-mail w Topbarze konkuruje o miejsce z logo + 3 linkami + „Wyloguj"; w paśmie ~640–1024px truncate skraca go do bezużytecznego „bar…" (fix `76a1d6b` zapobiegł wylewaniu przez `min-w-0`, ale nie stworzył miejsca). Rozwiązanie docelowe: **menu konta** — kompaktowy trigger w pasku (ikona osoby, wzorzec menu-button) otwierający popover z pełnym e-mailem + „Wyloguj". Nigdy nie truncatuje, działa na każdej szerokości.

Ustalenia wstępne (do potwierdzenia w planie):
- **Zakres**: menu konta na całym desktopie (≥sm) zastępuje inline e-mail; <sm zostaje istniejący hamburger-drawer (`TopbarMobileMenu`), który już pokazuje e-mail.
- **Trigger**: ikona osoby (lucide) — do rozważenia ikona vs ikona + skrócony e-mail.
- **„Wyloguj"**: przenoszone do wnętrza menu; znika osobny inline `<form>`. Linki nawigacji zostają inline.
- **Reuse**: nowe menu jako siostrzana wyspa React obok `TopbarMobileMenu`, współdzieląca prymitywy interakcji (Escape, klik-w-tło, focus-management, ARIA).

A11y: wzorzec menu-button (`aria-haspopup`, `aria-expanded`), Escape zamyka i przywraca fokus na trigger, klik poza zamyka. E2e w konwencji `/10x-e2e` (role/label/text, bez `waitForTimeout`).
