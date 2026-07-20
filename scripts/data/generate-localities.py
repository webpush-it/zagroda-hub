#!/usr/bin/env python3
"""Generate scripts/data/localities.pl.csv from the GUGiK PRNG localities export.

One-off, OFFLINE data-prep tool (not part of the Node runtime, tests or CI). It
turns the official Polish geographic-names registry (PRNG — miejscowości) into
the compact `(voivodeship, name, latitude, longitude)` asset the seed script
loads. See README.md in this directory for source, licence and how to re-run.

Source:  dane.gov.pl dataset 780, resource 30102
         "Państwowy Rejestr Nazw Geograficznych (PRNG) - miejscowości - XLSX"
         https://api.dane.gov.pl/resources/30102,.../file  (a zip holding one .xlsx)
Licence: CC BY 4.0 — PZGiK. Attribution required (see README.md).

Requires: openpyxl (`pip install openpyxl`). Run:
    python3 generate-localities.py PRNG_MIEJSCOWOSCI_XLSX.xlsx localities.pl.csv

Design notes:
- `name` is kept RAW (as PRNG spells it). Normalization is the DB's single source
  of truth (public.locality_normalize) — the seed computes name_normalized there,
  never here (plan-review F2). The JS/Python normalize below is used ONLY to pick
  one representative row per (voivodeship, normalized-name); any residual mismatch
  with the DB normalizer is harmless (the seed's ON CONFLICT resolves it).
- One row per (voivodeship, normalized-name). When a name repeats, the most
  prominent settlement wins (miasto > wieś > other standalone > part-of-locality),
  so e.g. "Kraków" resolves to the city, not a namesake hamlet.
- Coordinates come from the "współrzędne geograficzne" column in DMS
  (`50°43'05" 16°39'17"`, latitude first) and are converted to decimal degrees,
  rounded to 5 places (~1 m — far finer than locality-level need).
"""

import csv
import re
import sys
import unicodedata

import openpyxl

# XLSX column indices (0-based) — see PRNG_legenda_nazwy kolumn_XLS SHP GML.XLSX.
COL_NAME = 2  # nazwa główna
COL_KIND = 9  # rodzaj obiektu
COL_COORD = 19  # współrzędne geograficzne (DMS, "lat lng")
COL_VOIVODESHIP = 32  # województwo (already the 16 enum spellings, lower-case)

_DMS = re.compile(r"(\d+)°(\d+)'([\d.]+)\"")


def _dms_to_dd(token: str) -> float:
    d, m, s = _DMS.match(token).groups()
    return int(d) + int(m) / 60 + float(s) / 3600


def parse_coord(value: str) -> tuple[float, float]:
    lat_tok, lng_tok = str(value).strip().split()
    return round(_dms_to_dd(lat_tok), 5), round(_dms_to_dd(lng_tok), 5)


def normalize(name: str) -> str:
    """Mirror public.locality_normalize (approx) — dedup key only, never stored."""
    s = name.strip().replace("ł", "l").replace("Ł", "L")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower()


def prominence(kind: str) -> int:
    """Lower wins on a name clash: town, then village, then other, then a mere part."""
    if kind == "miasto":
        return 0
    if kind == "wieś":
        return 1
    if kind and kind.startswith("część"):
        return 3
    return 2


def main(src: str, out: str) -> None:
    workbook = openpyxl.load_workbook(src, read_only=True, data_only=True)
    sheet = workbook.active
    rows = sheet.iter_rows(values_only=True)
    next(rows)  # header

    best: dict[tuple[str, str], tuple[int, str, float, float]] = {}
    total = 0
    for row in rows:
        total += 1
        name = str(row[COL_NAME]).strip()
        voivodeship = str(row[COL_VOIVODESHIP]).strip()
        latitude, longitude = parse_coord(row[COL_COORD])
        key = (voivodeship, normalize(name))
        candidate = (prominence(row[COL_KIND]), name, latitude, longitude)
        current = best.get(key)
        if current is None or candidate < current:  # tie-break lexicographically
            best[key] = candidate

    out_rows = sorted((voivodeship, b[1], b[2], b[3]) for (voivodeship, _), b in best.items())
    with open(out, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")  # LF, not the csv default CRLF
        writer.writerow(["voivodeship", "name", "latitude", "longitude"])
        writer.writerows(out_rows)

    print(f"read {total} PRNG rows -> {len(out_rows)} unique (voivodeship, name) -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: generate-localities.py <PRNG_MIEJSCOWOSCI_XLSX.xlsx> <out.csv>")
    main(sys.argv[1], sys.argv[2])
