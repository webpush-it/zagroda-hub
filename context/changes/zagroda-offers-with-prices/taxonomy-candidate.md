# Kandydacka taksonomia oferty (do walidacji z właścicielem-doradcą)

> Wejście do prerekwizytu z `frame.md` (PRD Open Q#1). Źródło: oficjalny katalog
> Ogólnopolskiej Sieci Zagród Edukacyjnych (zagrodaedukacyjna.pl), zbadane
> 2026-07-23. **To propozycja do zatwierdzenia/przycięcia, nie decyzja.**

## 1. Tematyka zajęć — WYSOKA pewność

Dokładnie te 11 wartości to filtr katalogu OSZE (potwierdzone na dwóch stronach).
Rekomendacja: przyjąć 1:1, ewentualnie dopuścić wielokrotny wybór na ofertę.

| Token (ASCII enum) | Etykieta (PL) |
| --- | --- |
| `edukacja_regionalna` | Edukacja regionalna |
| `ekologia` | Ekologia |
| `ginace_zawody` | Ginące zawody |
| `kuchnia_domowa` | Kuchnia domowa |
| `przyroda` | Przyroda |
| `rekodzielo_artystyczne` | Rękodzieło artystyczne |
| `rolnictwo` | Rolnictwo i zajęcia gospodarskie |
| `tradycyjna_zywnosc` | Tradycyjna żywność |
| `zajecia_rekreacyjne` | Zajęcia rekreacyjne |
| `zajecia_sportowe` | Zajęcia sportowe |
| `zwyczaje_obrzedy` | Zwyczaje i obrzędy |

## 2. Adresaci — ŚREDNIA pewność (wymaga decyzji doradcy)

OSZE **nie publikuje** twardego enuma adresatów — opisuje ich prozą (dzieci /
dorośli / grupy zorganizowane / rodziny / seniorzy). Poniżej propozycja spójna z
istniejącym enumem `group_type` z S-11 (patrz uwaga niżej). Do potwierdzenia/
zawężenia:

| Token (ASCII enum) | Etykieta (PL) |
| --- | --- |
| `przedszkola` | Przedszkola |
| `szkoly_podstawowe` | Szkoły podstawowe |
| `szkoly_ponadpodstawowe` | Szkoły ponadpodstawowe |
| `rodziny` | Rodziny |
| `dorosli` | Dorośli / grupy zorganizowane |
| `seniorzy` | Seniorzy |

## 3. Zakres oferty

Na stronie OSZE „zakres oferty" nie jest osobnym filtrem — to opis słowny
(„pokazy i warsztaty", „wizyty jednodniowe lub dłuższe pobyty"). W modelu S-12
pokrywają to już istniejące pola oferty: `opis` (free text) + `czas trwania`.
Rekomendacja: **nie** wprowadzać osobnego enuma „zakres" w S-12.

## Uwaga projektowa: adresaci ≠ group_type

- `group_type` (S-11) = kim JEST gość składający zapytanie (deklaruje gość:
  szkoła / przedszkole / grupa indywidualna / inna).
- `adresaci` (S-12) = do kogo oferta jest KIEROWANA (deklaruje właściciel).

To dwie różne osie — nie łączyć w jeden enum. Warto jednak, by etykiety były
spójne (np. „Przedszkola" / „Szkoły") żeby gość rozumiał dopasowanie.

## Status

- Tematyka: gotowa do przyjęcia (wysoka pewność).
- Adresaci: **do zatwierdzenia z właścicielem-doradcą** — to jedyny element
  blokujący podniesienie frame confidence MEDIUM → HIGH i wejście w `/10x-plan`.

## Źródła

- Katalog OSZE — filtr tematyki: https://zagrodaedukacyjna.pl/
- Strona szczegółów zagrody (adresaci w prozie): https://www.zagrodaedukacyjna.pl/index.php?controller=places&id=229&option=com_places&task=details
- Centrum Doradztwa Rolniczego (opis sieci): https://www.cdr.gov.pl/transfer-wiedzy/broszury-publikacje/3416-ogolnopolska-siec-zagrod-edukacyjnych-ulotka
