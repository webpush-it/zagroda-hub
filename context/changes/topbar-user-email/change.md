---
change_id: topbar-user-email
title: Przywrócić wyświetlanie e-maila zalogowanego użytkownika w Topbarze
status: implemented
created: 2026-07-14
updated: 2026-07-14
archived_at: null
---

## Notes

Brakuje informacji o tym, na jaki adres e-mail jest zalogowany użytkownik. Kiedyś było to widoczne w Topbarze jako `<span>{user.email}</span>` (od initu `1b18c06`), ale wypadło przy migracji UI na motyw „Łąka i miód" w commicie `6c29252` (`feat(new-user-interface): Powierzchnie publiczne (p2)`, 2026-07-12) — NIE przy ostatnim refaktorze szerokości RWD.

Cel: przywrócić widoczność e-maila zalogowanego usera. Do rozważenia w planie:
- gdzie pokazać — desktop inline w `Topbar.astro` (`user ?` branch) oraz/lub nagłówek drawera mobilnego (`TopbarMobileMenu`, bo od `d2310f7` nawigacja na mobile żyje w drawerze),
- ewentualne wizualne powiązanie z akcją „Wyloguj",
- `user` pochodzi z `Astro.locals.user`; `TopbarMobileMenu` to wyspa React (`client:idle`) — email trzeba by przekazać propsem.
