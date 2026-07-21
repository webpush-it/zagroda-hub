# Locality dictionary asset (S-10)

`localities.pl.csv` maps every Polish locality to a coordinate, keyed by
`(voivodeship, name)`. It is the source the seed script
(`scripts/seed-localities.ts`) loads into `public.localities`, which
`public.locality_coords` then uses to resolve a zagroda's `city` + `voivodeship`
into `latitude`/`longitude` for distance sorting (FR-020, FR-030, US-04).

## Columns

| column        | notes                                                                   |
| ------------- | ----------------------------------------------------------------------- |
| `voivodeship` | exactly one of the 16 `public.voivodeship` enum values                  |
| `name`        | **raw** locality name as PRNG spells it — normalization is the DB's job |
| `latitude`    | decimal degrees (WGS 84), 5 dp                                          |
| `longitude`   | decimal degrees (WGS 84), 5 dp                                          |

`name_normalized` is deliberately **not** in the asset. The DB computes it via
`public.locality_normalize` at load time so the dictionary key and the
`locality_coords` lookup can never diverge (plan-review F2).

One row per `(voivodeship, normalized-name)`, resolved **honestly** when a name
repeats within a voivodeship:

- a single dominant **town** wins (so `Kraków` is the city, not a hamlet);
- otherwise, if all namesakes cluster within 5 km, the most prominent one wins
  (a few km is within locality-level approximation);
- otherwise the name is **ambiguous and omitted** — `city` + voivodeship cannot
  tell two far-apart villages apart, so rather than pick one at random (and show
  a confidently-wrong distance) we drop it. Such a zagroda falls back to the
  voivodeship centroid: `location_precise = false`, sorted coarsely, no `~X km`.

This drops ~12% of names (≈11k of ~90k) as genuinely ambiguous — the price of
not lying about distance. The seed prunes any locality no longer in the asset,
so re-running removes previously-loaded ambiguous names.

## Source & licence

- **Source:** Państwowy Rejestr Nazw Geograficznych (PRNG) — miejscowości,
  published by GUGiK on [dane.gov.pl](https://dane.gov.pl) — dataset `780`,
  resource `30102` (XLSX export).
- **Licence:** CC BY 4.0, państwowy zasób geodezyjny i kartograficzny (PZGiK).
  Free to use; attribution required. Any published work using this data must
  carry the note: _„Wykorzystano/opracowano na podstawie materiałów państwowego
  zasobu geodezyjnego i kartograficznego”_.

## Regenerating

The asset is committed, so regeneration is only needed to refresh against a newer
PRNG release. It is an offline step and needs no Node/CI tooling:

```bash
# 1. Download the PRNG "miejscowości - XLSX" export (a zip with one .xlsx):
curl -L "https://api.dane.gov.pl/resources/30102,panstwowy-rejestr-nazw-geograficznych-miejscowosci-format-xlsx/file" -o prng.zip
unzip prng.zip                       # -> PRNG_MIEJSCOWOSCI_XLSX.xlsx

# 2. Transform to the compact asset:
pip install openpyxl
python3 generate-localities.py PRNG_MIEJSCOWOSCI_XLSX.xlsx localities.pl.csv
```

`generate-localities.py` documents the column mapping and coordinate conversion.
