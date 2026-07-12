---
date: 2026-07-12T19:49:24+0200
researcher: Konrad Beśka
git_commit: a9254f763e402780843eb93d607778c6508d79a1
branch: master
repository: zagroda-hub
topic: "Błędy UI na mobile — poprawność layoutu od szerokości 320px"
tags: [research, codebase, mobile, responsive, 320px, tailwind, a11y-tap-targets]
status: complete
last_updated: 2026-07-12
last_updated_by: Konrad Beśka
---

# Research: Błędy UI na mobile — poprawność layoutu od szerokości 320px

**Date**: 2026-07-12T19:49:24+0200
**Researcher**: Konrad Beśka
**Git Commit**: a9254f7
**Branch**: master
**Repository**: zagroda-hub

## Research Question

Poprawić błędy UI na mobile tak, aby widok był poprawny **już od 320px**. Użytkownik zaobserwował problem w **nagłówku (Topbar)** oraz w **formularzu na odsłonie katalogu**. Prośba: sprawdzić, czy podobny problem występuje **także na innych odsłonach mobilnych**.

## Summary

**Tak — problem występuje szerzej niż na dwóch zgłoszonych odsłonach.** Redesign „Łąka i miód" był budowany mobile-first i *szkielety stron* (`p-4` + `card-surface` + `max-w-md/sm`, siatki landingu z prefiksami `sm:`/`md:`) są przy 320px poprawne. Regresje kumulują się w **czterech powtarzalnych klasach**:

1. **Nagłówek bez responsywności** — `Topbar.astro` to zawsze jeden poziomy rząd (logo z pełnym wordmarkiem + 4 linki nawigacji), bez `flex-wrap`, hamburgera, `min-w-0` ani `truncate`. ~448px treści w pasku, który przy 320px ma ~288px → **poziomy scroll całej strony**. To główny, zgłoszony bug. (**BREAKS**)
2. **Natywne kontrolki w wąskich/wielokolumnowych kontenerach** — `input[type=date/time/number]` mają wewnętrzną minimalną szerokość i nie kurczą się. Dotyczy: filtra katalogu (`date` ~116px obok `w-28`), `TurnusyEditor` (dwa `time` w `grid-cols-2` ~103px/kolumnę), daty w formularzu rezerwacji. (**BREAKS / RISKY**)
3. **Kontrolki-nakładki bez dopełnienia** — pole hasła ma `pl-10!` (lewa ikona) ale **brak `pr-10`**, więc tekst wsuwa się pod ikonę „pokaż hasło"; sam `PasswordToggle` ma pole dotyku ~16px. (**BREAKS**)
4. **Tap-targety < 44px** — sprzeczne z własnym guardrailem projektu (`btn-*` mają `min-height: 2.75rem`, ale linki nav Topbara ~40px, logo ~28px, chipy filtrów ~38px, `PasswordToggle` ~16px, liczne linki `text-sm` ~20px). (**RISKY**)

Do tego jeden tani fix globalny: **meta viewport bez `initial-scale=1`** (`Layout.astro:24`).

Odsłony **czyste** (potwierdzone): landing (`index.astro`), `ZagrodaCard`, `404.astro`, `anuluj.astro`, `OAuthButtons`, `ZagrodaProfileForm`, `PhotoUpload`.

## Detailed Findings

Kalkulacja szerokości przy 320px: `p-4` (16px×2) → karta 288px; `card-surface` padding 1.5rem (24px×2) → **~240px użytecznej treści** w karcie (`src/styles/global.css:167-176`, `:231-247`).

### A. Nagłówek / Topbar — GŁÓWNY BUG (BREAKS)

- **Brak jakiegokolwiek traktowania responsywnego** — `src/components/Topbar.astro:10-47`. Zero prefiksów `sm:/md:`, brak `flex-wrap`, `hidden`, hamburgera, trybu icon-only, `min-w-0`, `truncate`. Zawsze pełny poziomy rząd: `flex items-center justify-between gap-3` (`:10-11`) z logo po lewej i klastrem `flex items-center gap-4` po prawej (`:18` zalogowany / `:35` gość).
- **Szacunek szerokości (stan zalogowany)**: Logo `variant="full" size={28}` ≈ **146px** (28px SVG + `gap-2` 8px + wordmark „Zagroda Hub" `text-lg` extrabold ≈ 105-115px) + nav „Katalog/Panel/Zapytania/Wyloguj" ≈ 210px tekstu + 3×`gap-4` (48px) + `px-4` (32px) + `gap-3` (12px) ≈ **~448px** wobec ~288px dostępnych. Dzieci flex mają domyślnie `min-width:auto` i nie ma `min-w-0`/`flex-wrap` → **pasek nie może się skurczyć → overflow całej strony**. Stan gościa („Katalog/Zaloguj się/Zarejestruj się") ≈ 434px — ten sam efekt.
- **Tap-target linków nav ~40px, nie 44px** — `src/components/Topbar.astro:7`. Komentarz twierdzi „py-2.5 + text-sm ≈ 44px", ale `py-2.5` (20px) + `text-sm` line-height (20px) = **~40px**, poniżej guardrailu 44px.
- **Tap-target linku logo ~28px** — `src/components/Topbar.astro:13` (`<a>` bez paddingu wokół `Logo size={28}`).
- **Logo bez `max-width`** — `src/components/brand/Logo.astro:17-23` (przy 28px nieszkodliwe, ale wordmark ~105-115px to stały koszt, którego pasek nie może zredukować).

### B. Formularz katalogu — ZGŁOSZONY BUG (RISKY→BREAKS)

- **Rząd data + liczba osób** — `src/pages/katalog.astro:146-164`: `<div class="flex gap-3">` z `flex-1` `input[type=date]` i `w-28` (112px) `input[type=number]`. Przy ~240px treści: data = 240 − 112 − 12 = **~116px**. Natywna kontrolka daty (glif kalendarza + „dd.mm.rrrr") ma intrinsic min ~120-150px i nie kurczy się poniżej treści → clipping/overflow. `select`y województwa/miasta są bezpieczne (przycinają tekst opcji).

### C. Pola hasła (auth) — BUG (BREAKS)

- **`PasswordToggle` — pole dotyku ~16px** — `src/components/auth/PasswordToggle.tsx:10-17`. `absolute right-3` wokół ikony `size-4` (16px), bez paddingu/`min-h`/`size-11` → hit-area ~16×16px. Na każdym polu hasła: `SignInForm`, `SignUpForm`, `ResetPasswordForm`.
- **Brak prawego dopełnienia inputu hasła** — `src/components/auth/FormField.tsx:48`: `cn("input-field pl-10!", ...)` dodaje lewy padding pod ikonę wiodącą, ale **nie ma `pr-10`**. `input-field` daje tylko `padding: .625rem .75rem` (`global.css:237`). `PasswordToggle` jest `absolute right-3` nad content-boxem → wpisywane hasło/placeholder wsuwa się **pod ikonę oka**, kontrolka trudna do trafienia. Lewa ikona OK (`pl-10!` mija `left-3` + `size-4`); problem po prawej.
- **Etykiety submit `whitespace-nowrap`** — `src/components/ui/button.tsx:8` (baza `buttonVariants`) używane przez `SubmitButton.tsx:15` (`h-11 w-full`). „Ustaw nowe hasło" (`ResetPasswordForm.tsx:110`), „Zakładanie konta…" (`SignUpForm.tsx:129`) mieszczą się dziś, ale bez marginesu bezpieczeństwa (brak zawijania → clipping przy większym foncie systemowym). RISKY.

### D. TurnusyEditor — natywne `time` (RISKY)

- **Dwa `input[type=time]` w `grid-cols-2`** — `src/components/zagroda/TurnusyEditor.tsx:71` (grid), inputy `:76-84` i `:96-104`. W karcie turnusu (`border p-3`, `:41`): 240 − 24 − 2 = 214px, − `gap-2` (8) → **~103px/kolumnę**, − padding `input-field` (24px) − border (2px) → ~77px content-box. Natywne `time` (HH:MM + spinner/glif) przy ~77px przycinają wskaźnik/spinner (zależne od silnika; Firefox szerszy niż Chrome).
- **Delete button OK** — `TurnusyEditor.tsx:66` `size-11` (44px). Wiersz to układ 2-rzędowy (label+delete, potem grid czasów), NIE pojedynczy 4-elementowy rząd — pierwotna hipoteza skorygowana.

### E. RequestsList (panel) — RISKY (kosmetyka + tap-target)

- **Chipy filtrów — overflow OK, tap-target ~38px** — `src/components/booking/RequestsList.tsx:32` kontener `overflow-x-auto`, chipy `shrink-0` (`:46`) → celowy pasek scrolla, brak overflow strony. Ale `px-3 py-2 text-sm` (`:45-50`) → ~38px wysokości, < 44px.
- **Rząd badge + „Wysłano <data>" bez wrap/`shrink-0`** — `RequestsList.tsx:72` (`flex items-center gap-2`) + `:74`. Dostępne ~176px; „Zaakceptowane" (~98px) + „Wysłano 2026-07-12" (~100px) ≈ 206px → data zawija, pigułka badge może się zniekształcić. `StatusBadge` bez `shrink-0`/`whitespace-nowrap`.
- **Długa etykieta turnusu bez `break-words`** — `RequestsList.tsx:81-84` w rzędzie `flex-wrap` (`:76`); pojedyncze długie słowo (label wpisany przez użytkownika) bez `break-words`/`min-w-0` przepełni ~176px.

### F. RequestDecision — RISKY-minor (kosmetyka)

- **Przyciski potwierdzenia w `flex gap-2` (dwa `flex-1`)** — `src/components/booking/RequestDecision.tsx:133-153` (odrzuć) i `:177-197` (cofnij). W czerwonym boxie `p-3`: ~103px/przycisk; po `px-4` (32px) + ikona (16px) zostaje ~47px na tekst → „Tak, odrzuć"/„Tak, cofnij" zawijają w 2 linie (`min-h-11` absorbuje wysokość, brak clippingu). Główne Akceptuj/Odrzuć są `w-full` stackowane (`:124, :162, :206`) — **OK**.
- **`StatusBadge` bez `whitespace-nowrap`** — `src/components/booking/StatusBadge.tsx:16-18` (źródło zawijania w E).

### G. Szczegóły zapytania (panel) — RISKY-minor

- **`dd` bez `min-w-0`/`break-words`** — `src/pages/dashboard/zapytania/[id].astro:92-97` (Turnus, `text-right`) i `:107-110` (imię gościa). Długi label/token zawija i ściska `dt`. Rząd E-mail (`:111-121`) zrobiony poprawnie: `gap-2`, `dd` `min-w-0`, anchor `block truncate` — wzorzec do naśladowania.

### H. Strona zagrody (publiczna) — RISKY

- **`h1` nazwy zagrody bez `break-words`** — `src/pages/zagrody/[id].astro:88` (`text-2xl font-bold`). Długi niezawijalny token nazwy przy 24px bold przepełni ~240px (wielowyrazowe nazwy zawijają OK).
- **Wiersz turnusu `li justify-between` bez `min-w-0`/`truncate`** — `src/pages/zagrody/[id].astro:102-105` (label rywalizuje z tokenem czasu; zawija, ściska).

### I. Globalne — RISKY (tani fix)

- **Meta viewport bez `initial-scale=1`** — `src/layouts/Layout.astro:24`: `<meta name="viewport" content="width=device-width" />`. Bez `initial-scale=1` część przeglądarek mobilnych (iOS Safari przy zmianie orientacji) nie blokuje zoomu na 1, co potęguje overflow. Zalecane: `width=device-width, initial-scale=1`.

### J. Tap-targety inline (przekrojowe) — LOW/RISKY

Linki `text-sm` ~20px wysokości poniżej 44px: „← Wróć do katalogu" (`zagrody/[id].astro:69`), „Nie, wróć do katalogu" (`CancelRequest.tsx:109`), „Przejdź do katalogu" (`zagrody/[id].astro:125`, `anuluj.astro:35`), „Nie pamiętam hasła" (`SignInForm.tsx:80-83`), stopki auth (`signin.astro:18`, `signup.astro:18`, `forgot-password.astro:42`, `confirm-email.astro:41`).

## Code References

- `src/components/Topbar.astro:7,10-47` — nieresponsywny pasek + tap-targety (bug główny)
- `src/components/brand/Logo.astro:17-23` — wordmark „full" ~146px, stały koszt paska
- `src/pages/katalog.astro:146-164` — rząd date(`flex-1`) + number(`w-28`), data ~116px (bug zgłoszony)
- `src/components/auth/FormField.tsx:48` — `pl-10!` bez `pr-10`, tekst pod ikoną oka
- `src/components/auth/PasswordToggle.tsx:10-17` — hit-area ~16px
- `src/components/ui/button.tsx:8` — `whitespace-nowrap` w bazie przycisku
- `src/components/zagroda/TurnusyEditor.tsx:71,76-84,96-104` — `time` w `grid-cols-2` ~103px
- `src/components/booking/RequestsList.tsx:32,45-50,72-84` — chipy 38px, wrap badge+data, label
- `src/components/booking/RequestDecision.tsx:133-153,177-197` — przyciski potwierdzeń ~103px
- `src/components/booking/StatusBadge.tsx:16-18` — brak `whitespace-nowrap`
- `src/pages/dashboard/zapytania/[id].astro:92-110` — `dd` bez `break-words` (E-mail OK)
- `src/pages/zagrody/[id].astro:69,88,102-105` — h1 bez break-words, wiersz turnusu, link back
- `src/layouts/Layout.astro:24` — meta viewport bez `initial-scale=1`
- `src/styles/global.css:167-176,180-227,231-247` — card-surface 1.5rem, btn min-h 44px, input-field w-100%

## Architecture Insights

- **Guardrail 44px istnieje, ale niespójnie egzekwowany.** `btn-primary`/`btn-secondary` mają `min-height: 2.75rem` (`global.css:180,207`) i komentarz „tap-target ≥44px (guardrail jednoręczności)". Reguła NIE jest przeniesiona na: linki nav (Topbar), chipy filtrów, `PasswordToggle`, linki `text-sm`. Rozważyć wspólne utility (np. `@utility tap-target { min-height: 2.75rem }`) lub `min-h-11` na wszystkich interaktywnych elementach.
- **Wzorzec „poprawny" jest już w repo** — `ZagrodaCard.astro` (`min-w-0` + `truncate` + `line-clamp-2` + `shrink-0`) i rząd E-mail w `zapytania/[id].astro:111-121` to gotowe wzorce do skopiowania na wiersze, które ich nie mają.
- **Natywne kontrolki `date/time/number` to systemowe ryzyko na wąskich ekranach** — nie kurczą się poniżej intrinsic min i różnią się między silnikami. Wszędzie, gdzie są w wielokolumnowym/wąskim kontenerze (katalog, TurnusyEditor), potrzebują albo pełnej szerokości (stack), albo min-width dobranego do 320px.
- **Szkielety są mobile-first i zdrowe** — landing z prefiksami `sm:`/`md:`, wszystkie karty `w-full`/`max-w-*`, obrazy z `aspect-*`/`object-cover`. Problemy to punktowe regresje, nie systemowa wada layoutu — zakres naprawy jest ograniczony i przewidywalny.

## Historical Context (from prior changes)

- `context/archive/2026-07-12-new-user-interface/plan.md` — redesign „Łąka i miód", z którego pochodzi cały obecny UI. Guardrail: „jednokolumnowy `max-w-md`/`max-w-*` mobile-first zostaje", „tap-targets ≥ 44px na mobile", weryfikacja manualna „na viewporcie Pixel 5 (pion)". **Pixel 5 to ~393px CSS px** — dlatego 320px (np. iPhone SE 1gen / Galaxy Fold zamknięty) nie był łapany w manualnej weryfikacji redesignu; stąd regresje ujawniają się dopiero teraz.
- `context/archive/2026-07-12-new-user-interface/reviews/impl-review.md` — review redesignu skupione na kontraście WCAG i drift motywu; responsywność <393px nie była w zakresie.
- `context/archive/2026-06-14-testing-e2e-critical-flow-mobile/plan.md` — polityka e2e Pixel 5 (portrait). E2e nie testuje 320px.

## Related Research

- `context/archive/2026-07-12-new-user-interface/research.md` — pełna analiza motywu/idiomów UI (mapowanie klas, pliki powierzchni).

## Open Questions

- **Docelowy breakpoint dolny**: potwierdzić 320px jako minimum (iPhone SE 1gen 320px, Galaxy Fold 280px). Jeśli 320px — czy dopuszczamy delikatny scroll poziomy w skrajnych przypadkach, czy zero-tolerancja?
- **Topbar — jaki wzorzec zwinięcia?** Opcje: (a) icon-only/skrót wordmarku < `sm:`, (b) hamburger + drawer, (c) `flex-wrap` na dwa rzędy, (d) logo tylko-znak (`variant` bez wordmarku) na mobile. Decyzja estetyczna do `/10x-plan` lub `/10x-frame`.
- **Weryfikacja na żywo**: research jest statyczny (analiza klas). Plan/impl powinien potwierdzić findingi w DevTools/Playwright przy 320px (i sprawdzić realne intrinsic-min natywnych kontrolek w Chrome i Firefox mobile).
- **Guardrail tap-target**: czy wprowadzić wspólne utility `tap-target`/`min-h-11` i wymusić je lintem/review, żeby regresja nie wracała?
- **Priorytetyzacja**: czy zakres tej zmiany to tylko klasa „BREAKS" (Topbar, hasła, natywne daty/czasy), czy też pełne dopięcie tap-targetów i kosmetyki wrap (E-H)?
