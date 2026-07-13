# Frame Brief: Poprawność UI na mobile od 320px

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Layout psuje się przy szerokości 320px — widocznie w **nagłówku (Topbar)** oraz w **formularzu na odsłonie katalogu**. Cel: widok ma być poprawny **już od 320px**.

## Initial Framing (preserved)

- **User's stated cause or approach**: „Błędy UI na mobile" — traktowane jako bugi do naprawienia w miejscach, gdzie się ujawniają (nagłówek, formularz katalogu).
- **User's proposed direction**: Naprawić je i sprawdzić, czy inne odsłony mobilne mają ten sam problem (research wykonany → tak, powtarzalna klasa na wielu powierzchniach).
- **Pre-dispatch narrowing**: (1) Zakres = **pełny przemiał 320px** (klasa BREAKS + tap-targety <44px + kosmetyka zawijania). (2) Podłoga = **używalny @320, dopięty @360+** (nie twarde zero-scroll). (3) Egzekwowanie tap-targetów ≥44px = **w zakresie**.

## Dimension Map

Klasa objawu „psuje się przy 320px" może pochodzić z dowolnego z tych wymiarów:

1. **Złożony layout bez zwinięcia responsywnego** — Topbar to zawsze jeden niezawijalny poziomy rząd (logo z wordmarkiem + 4 linki). ← *tu wylądowało oko użytkownika (nagłówek)*
2. **Natywne kontrolki formularza o intrinsic min-width w wąskich/wielokolumnowych kontenerach** — `date/time/number` w `flex gap`/`grid-cols-2` (katalog, TurnusyEditor, rezerwacja). ← *druga obserwacja użytkownika (formularz katalogu)*
3. **Kontrolki-nakładki bez zarezerwowanego miejsca** — pole hasła `pl-10!` bez `pr-10`; `PasswordToggle` absolutnie nad treścią.
4. **Guardrail tap-target zdefiniowany, ale nieprzeniesiony** — 44px tylko na `btn-*`; linki nav, chipy, toggle, linki `text-sm` poniżej.
5. **Nieograniczona treść (długie/niezawijalne) bez zabezpieczeń wrap** — brak `min-w-0`/`truncate`/`break-words` na h1, `dd`, badge+data, labelach.
6. **Meta viewport bez `initial-scale=1`** — wzmacnia overflow.
7. **Korzeń: podłoga poprawności 320px nigdy nie istniała** — struktura odziedziczona ze startera + manualna QA na Pixel 5 (~393px); redesign tylko przeskórował markup, nie zmieniając struktury responsywnej. ← *kandydat na przeramowanie*

## Hypothesis Investigation

Dowody z fazy `/10x-research` (tasks #2–5, file:line zweryfikowane w tym repo) + krzyżowy check git (regresja vs pre-existing).

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| D1: Topbar bez zwinięcia responsywnego | `Topbar.astro:10-47` ~448px treści vs ~288px @320; brak `flex-wrap`/`min-w-0`/hamburgera. git: identyczny poziomy rząd sprzed redesignu | STRONG |
| D2: Natywne kontrolki w wąskich kontenerach | `katalog.astro:146-164` data ~116px obok `w-28`; `TurnusyEditor.tsx:71` dwa `time` ~103px/kol. git: identyczne sprzed redesignu | STRONG |
| D3: Nakładka bez rezerwy miejsca | `FormField.tsx:48` `pl-10!` bez `pr-10`; `PasswordToggle.tsx:10-17` hit ~16px. git: identyczne sprzed redesignu | STRONG |
| D4: Tap-target nieprzeniesiony | `global.css:180` btn `min-height:2.75rem` vs `Topbar.astro:7` ~40px, `RequestsList.tsx:45-50` ~38px, `PasswordToggle` ~16px, linki `text-sm` ~20px | STRONG |
| D5: Treść bez zabezpieczeń wrap | `RequestsList.tsx:72-84`, `zagrody/[id].astro:88`, `zapytania/[id].astro:92-110`. Kontr-wzorzec poprawny: `ZagrodaCard.astro` (`min-w-0`+`truncate`) | STRONG (kosmetyka) |
| D6: viewport bez initial-scale | `Layout.astro:24`. git: identyczne sprzed redesignu | WEAK (wzmacniacz, nie przyczyna) |
| D7 (korzeń): brak podłogi 320px | git: **wszystkie** wzorce D1–D3, D6 pre-existing/odziedziczone; `context/archive/2026-07-12-new-user-interface/plan.md` — QA baseline Pixel 5 (~393px), 320px nigdy nie ćwiczone | STRONG |

## Narrowing Signals

- **Wszystkie zgłoszone i pochodne wzorce są PRE-EXISTING, nie regresją redesignu** (git `show 45e1a63^`): Topbar, rząd katalogu, pole hasła i meta viewport miały identyczną strukturę przed redesignem. To przenosi objaw z „redesign zepsuł mobile" na „mobile @320 nigdy nie działało".
- **Kontr-wzorzec już istnieje w repo** (`ZagrodaCard.astro`, rząd E-mail w `zapytania/[id].astro:111-121`) — poprawne `min-w-0`/`truncate`/`shrink-0`/`break-words`. Fix jest znany i lokalny, nie wymaga nowej architektury.
- **Użytkownik wybrał pełny sweep + egzekwowanie 44px** — zgodne z korzeniem D7 (systemowa podłoga), nie z łataniem dwóch miejsc.

## Cross-System Convention

Konwencja mobile-first w tym repo jest już poprawnie zrealizowana w szkieletach (landing z prefiksami `sm:`/`md:`, karty `w-full`/`max-w-*`, obrazy `aspect-*`) i we wzorcu `ZagrodaCard`. Wiodąca hipoteza (D7) pasuje do konwencji: brakuje nie nowego podejścia, lecz **konsekwentnego zastosowania istniejącego wzorca + jednej wspólnej reguły tap-target** na powierzchniach, które je pominęły. Natywne kontrolki `date/time/number` to znane systemowe ryzyko na wąskich ekranach — konwencja: pełna szerokość (stack) albo min-width dobrany do 320px.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: aplikacja nigdy nie miała podłogi poprawności przy 320px — redesign przeskórował markup startera, którego struktura responsywna była walidowana tylko przy ~393px (Pixel 5); należy ustanowić **używalną podłogę 320px + przeniesioną regułę tap-target ≥44px** na wszystkich powierzchniach, a nie łatać dwóch zauważonych miejsc.

Objaw w nagłówku i formularzu katalogu (D1, D2) to nie odosobnione bugi, lecz najbardziej widoczne przejawy braku podłogi (D7), który powtarza się w D3–D5. Naprawa tylko D1+D2 zostawi pola hasła, TurnusyEditor, chipy i tap-targety nadal zepsute. Adresując korzeń: definiujemy próg 320px jako kryterium akceptacji, przenosimy istniejący wzoriec (`min-w-0`/`truncate`/wrap) i wspólny tap-target na wszystkie powierzchnie — i domykamy klasę objawów naraz. Framing „bugi do naprawienia" był kierunkowo dobry, ale zbyt wąski: to sweep z regułą, nie punktowa łatka.

## Confidence

- **HIGH** — silne dowody file:line na wszystkich wymiarach (research, ten projekt), decydujący krzyżowy check git (pre-existing, nie regresja), zgodność z konwencją (poprawny wzorzec już w repo), oraz spójny wybór zakresu przez użytkownika (pełny sweep).

## What Changes for /10x-plan

Plan powinien być **systemowym sweepem podłogi 320px** (per grupa powierzchni, wzorem faz redesignu), z: (a) jednym współdzielonym prymitywem tap-target ≥44px zamiast per-element, (b) przeniesieniem istniejącego wzorca `min-w-0`/`truncate`/`break-words` na wskazane wiersze, (c) rozwiązaniem natywnych kontrolek `date/time/number` w wąskich kontenerach, (d) bramką regresji (weryfikacja @320px w DevTools/Playwright) jako kryterium sukcesu. **Wybór wzorca nawigacji Topbara** (hamburger vs logo-tylko-znak vs `flex-wrap` vs icon-only) to decyzja rozwiązania — należy do /10x-plan, nie do tego briefu.

## References

- Source files: `Topbar.astro:7,10-47`, `katalog.astro:146-164`, `FormField.tsx:48`, `PasswordToggle.tsx:10-17`, `TurnusyEditor.tsx:71`, `RequestsList.tsx:45-84`, `zagrody/[id].astro:88`, `zapytania/[id].astro:92-110`, `Layout.astro:24`, `global.css:167-247`
- Related research: `context/changes/fix-mobile-ui-bugs/research.md`
- Cross-check: `git show 45e1a63^` (pre-redesign struktura) — wszystkie wzorce pre-existing
- Historical baseline: `context/archive/2026-07-12-new-user-interface/plan.md` (QA Pixel 5 ~393px)
- Investigation tasks: #2, #3, #4, #5 (faza research); krzyżowy check git w fazie frame
