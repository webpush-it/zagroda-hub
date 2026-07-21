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
- One row per (voivodeship, normalized-name). When a name repeats within a
  voivodeship we resolve it *honestly* (S-10 impl fix):
    * a single dominant "miasto" wins (so "Kraków" is the city, not a hamlet);
    * otherwise, if all namesakes cluster within AMBIGUOUS_SPREAD_KM, the most
      prominent one wins (a few km is within locality-level approximation);
    * otherwise the name is AMBIGUOUS and is DROPPED from the asset — free text
      `city` + voivodeship cannot tell two far-apart villages apart, so rather
      than pick one at random (and show a confidently-wrong "~X km"), we omit it.
      At runtime such a zagroda falls back to the voivodeship centroid
      (location_precise=false → sorts coarsely, no distance badge).
- Coordinates come from the "współrzędne geograficzne" column in DMS
  (`50°43'05" 16°39'17"`, latitude first) and are converted to decimal degrees,
  rounded to 5 places (~1 m — far finer than locality-level need).
"""

from __future__ import annotations

import csv
import math
import re
import sys
import unicodedata

import openpyxl

# Namesakes within this radius are treated as one locality-level point (the most
# prominent wins); beyond it, the name is ambiguous and dropped (see docstring).
AMBIGUOUS_SPREAD_KM = 5.0

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


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371.0
    d_lat = math.radians(b[0] - a[0])
    d_lng = math.radians(b[1] - a[1])
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(d_lng / 2) ** 2
    )
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def resolve(candidates: list[tuple[int, str, float, float]]) -> tuple[tuple[int, str, float, float] | None, str]:
    """Pick one representative for a (voivodeship, name) group, or drop it.

    Returns (winner, reason). winner is None when the name is ambiguous (several
    far-apart namesakes with no dominant town) — the caller omits it so runtime
    falls back to the voivodeship centroid instead of a random wrong point.
    """
    if len(candidates) == 1:
        return candidates[0], "unique"
    towns = [c for c in candidates if c[0] == 0]
    if len(towns) == 1:  # one clear town among namesakes → the town is meant
        return towns[0], "town"
    coords = [(c[2], c[3]) for c in candidates]
    spread = max(_haversine_km(coords[i], coords[j]) for i in range(len(coords)) for j in range(i + 1, len(coords)))
    if spread <= AMBIGUOUS_SPREAD_KM:  # clustered → locality-level approx is fine
        return min(candidates), "close"
    return None, "ambiguous"


def main(src: str, out: str) -> None:
    workbook = openpyxl.load_workbook(src, read_only=True, data_only=True)
    sheet = workbook.active
    rows = sheet.iter_rows(values_only=True)
    next(rows)  # header

    groups: dict[tuple[str, str], list[tuple[int, str, float, float]]] = {}
    total = 0
    for row in rows:
        total += 1
        name = str(row[COL_NAME]).strip()
        voivodeship = str(row[COL_VOIVODESHIP]).strip()
        latitude, longitude = parse_coord(row[COL_COORD])
        key = (voivodeship, normalize(name))
        groups.setdefault(key, []).append((prominence(row[COL_KIND]), name, latitude, longitude))

    out_rows: list[tuple[str, str, float, float]] = []
    reasons = {"unique": 0, "town": 0, "close": 0, "ambiguous": 0}
    dropped_examples: list[str] = []
    for (voivodeship, _), candidates in groups.items():
        winner, reason = resolve(candidates)
        reasons[reason] += 1
        if winner is None:
            if len(dropped_examples) < 15:
                dropped_examples.append(f"{voivodeship} / {candidates[0][1]} (x{len(candidates)})")
            continue
        out_rows.append((voivodeship, winner[1], winner[2], winner[3]))

    out_rows.sort()
    with open(out, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")  # LF, not the csv default CRLF
        writer.writerow(["voivodeship", "name", "latitude", "longitude"])
        writer.writerows(out_rows)

    kept = len(out_rows)
    ambiguous = reasons["ambiguous"]
    print(f"read {total} PRNG rows -> {len(groups)} (voivodeship, name) groups -> {kept} kept in {out}")
    print(
        f"  kept: unique={reasons['unique']} town={reasons['town']} close(<={AMBIGUOUS_SPREAD_KM:g}km)={reasons['close']}"
    )
    print(f"  dropped as AMBIGUOUS (far-apart namesakes, no dominant town): {ambiguous}")
    if dropped_examples:
        print("  examples: " + "; ".join(dropped_examples))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: generate-localities.py <PRNG_MIEJSCOWOSCI_XLSX.xlsx> <out.csv>")
    main(sys.argv[1], sys.argv[2])
