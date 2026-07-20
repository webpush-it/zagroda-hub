// S-10 seed + backfill (FR-020/FR-030): load the locality dictionary asset into
// public.localities, then backfill coordinates onto existing published zagrody.
// Idempotent and re-runnable — one run per environment, after `db:push` and
// before `wrangler deploy` (see Migration Notes / deploy runbook).
//
// The dictionary asset carries RAW names; name_normalized is computed HERE by the
// DB via public.locality_normalize — the same expression locality_coords uses at
// lookup time — so the stored key and the lookup can never diverge (plan-review
// F2). Runs directly under Node's native TypeScript stripping (Node >= 22.18).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

/** A row of the committed dictionary asset (scripts/data/localities.pl.csv). */
export interface LocalityRow {
  voivodeship: string;
  name: string;
  latitude: number;
  longitude: number;
}

/** Published-zagrody coverage after a backfill (the S-10 quality gate). */
export interface MatchStats {
  published: number;
  precise: number;
  /** precise / published, or null when nothing is published (vacuous). */
  matchRate: number | null;
  /** Distinct (voivodeship, city) of published rows that fell back to a centroid. */
  misses: { voivodeship: string | null; city: string | null; count: number }[];
}

/** Match-rate below this (with published rows present) is a remediation gate. */
export const MATCH_RATE_THRESHOLD = 0.9;

const CSV_PATH = join(dirname(fileURLToPath(import.meta.url)), "data", "localities.pl.csv");

/**
 * A correct RFC 4180 reader (quotes, doubled quotes, CRLF). The asset has no
 * commas or newlines inside fields, but two names carry embedded quotes
 * (e.g. `Mazewo Dworskie"A"`), so a naive split would corrupt them.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse the dictionary CSV text (header `voivodeship,name,latitude,longitude`). */
export function parseLocalitiesCsv(text: string): LocalityRow[] {
  const [, ...dataRows] = parseCsv(text);
  const out: LocalityRow[] = [];
  for (const cols of dataRows) {
    if (cols.length < 4) continue; // skip blank/short lines
    const [voivodeship, name, lat, lng] = cols;
    out.push({ voivodeship, name, latitude: Number(lat), longitude: Number(lng) });
  }
  return out;
}

/**
 * Upsert dictionary rows into public.localities. name_normalized is computed by
 * the DB (locality_normalize) so it can never drift from the lookup. `distinct
 * on` collapses any rows that normalize to the same key within one statement
 * (ON CONFLICT cannot touch a row twice); `do update` makes re-runs converge.
 * Returns the number of rows upserted.
 */
export async function loadLocalities(pg: Client, rows: LocalityRow[]): Promise<number> {
  await pg.query("drop table if exists _localities_stage");
  await pg.query(
    `create temp table _localities_stage (
       voivodeship text, name text, latitude double precision, longitude double precision
     )`,
  );

  const BATCH = 1000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const tuples: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const b = j * 4;
      tuples.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
      params.push(r.voivodeship, r.name, r.latitude, r.longitude);
    });
    await pg.query(
      `insert into _localities_stage (voivodeship, name, latitude, longitude) values ${tuples.join(", ")}`,
      params,
    );
  }

  const result = await pg.query(
    `insert into public.localities (voivodeship, name, name_normalized, latitude, longitude)
     select distinct on (s.voivodeship, public.locality_normalize(s.name))
            s.voivodeship::public.voivodeship,
            s.name,
            public.locality_normalize(s.name),
            s.latitude,
            s.longitude
     from _localities_stage s
     order by s.voivodeship, public.locality_normalize(s.name), s.name
     on conflict (voivodeship, name_normalized) do update
       set name = excluded.name,
           latitude = excluded.latitude,
           longitude = excluded.longitude`,
  );
  await pg.query("drop table if exists _localities_stage");
  return result.rowCount ?? 0;
}

/**
 * Backfill coordinates onto every zagroda from its city/voivodeship via
 * locality_coords. Set-based, idempotent — closes the gap for rows published
 * before their locality landed in the dictionary (the trigger only fires on
 * insert/update, not retroactively). Returns the number of zagrody updated.
 */
export async function backfillZagrody(pg: Client): Promise<number> {
  // UPDATE...FROM cannot lateral-reference its own target table, so the LATERAL
  // call lives in a subquery over a fresh zagrody alias (zz) and is joined back
  // by id. LEFT JOIN keeps rows whose city/voivodeship resolve to no coords
  // (empty city) — lat/lng go NULL and location_precise coalesces to false,
  // matching the trigger's zero-row-safety (plan-review F5). Semantics are the
  // plan's set-based backfill; the shape is what Postgres accepts.
  const result = await pg.query(
    `update public.zagrody z
     set latitude = c.latitude,
         longitude = c.longitude,
         location_precise = coalesce(c.is_precise, false)
     from (
       select zz.id, lc.latitude, lc.longitude, lc.is_precise
       from public.zagrody zz
       left join lateral public.locality_coords(zz.voivodeship, zz.city) lc on true
       where zz.voivodeship is not null
     ) c
     where c.id = z.id`,
  );
  return result.rowCount ?? 0;
}

/** Coverage of published zagrody, with the miss list for remediation. */
export async function computeMatchStats(pg: Client): Promise<MatchStats> {
  const totals = await pg.query<{ published: string; precise: string }>(
    `select
       count(*) filter (where is_published) as published,
       count(*) filter (where is_published and location_precise) as precise
     from public.zagrody`,
  );
  const published = Number(totals.rows[0]?.published ?? 0);
  const precise = Number(totals.rows[0]?.precise ?? 0);

  const misses = await pg.query<{ voivodeship: string | null; city: string | null; count: string }>(
    `select z.voivodeship::text as voivodeship, z.city, count(*)::text as count
     from public.zagrody z
     where z.is_published and not z.location_precise
     group by z.voivodeship, z.city
     order by count(*) desc
     limit 200`,
  );

  return {
    published,
    precise,
    matchRate: published > 0 ? precise / published : null,
    misses: misses.rows.map((r) => ({ voivodeship: r.voivodeship, city: r.city, count: Number(r.count) })),
  };
}

/** Load the asset, backfill, and report coverage. Returns the collected stats. */
export async function seedLocalities(pg: Client, rows: LocalityRow[]): Promise<MatchStats> {
  const upserted = await loadLocalities(pg, rows);
  const { rows: dictCountRows } = await pg.query<{ count: string }>("select count(*) as count from public.localities");
  const updated = await backfillZagrody(pg);
  const stats = await computeMatchStats(pg);

  console.log(`  localities upserted:   ${upserted}`);
  console.log(`  localities total:      ${dictCountRows[0]?.count ?? "?"}`);
  console.log(`  zagrody backfilled:    ${updated}`);
  if (stats.matchRate === null) {
    console.log(`  published zagrody:     0 (match-rate vacuous)`);
  } else {
    console.log(
      `  published zagrody:     ${stats.published} (precise ${stats.precise} = ${(stats.matchRate * 100).toFixed(1)}%)`,
    );
  }
  return stats;
}

/** env SUPABASE_DB_URL, else the local stack's DB_URL from `supabase status`. */
function resolveDbUrl(): string {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  try {
    const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" });
    const status = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as { DB_URL?: string };
    if (status.DB_URL) return status.DB_URL;
  } catch {
    // fall through to the error below
  }
  throw new Error(
    "Set SUPABASE_DB_URL, or start the local stack (`npm run db:start`) so `supabase status` resolves it.",
  );
}

async function main(): Promise<void> {
  const rows = parseLocalitiesCsv(readFileSync(CSV_PATH, "utf8"));
  console.log(`Loading ${rows.length} localities from ${CSV_PATH}`);

  const pg = new Client({ connectionString: resolveDbUrl() });
  await pg.connect();
  let stats: MatchStats;
  try {
    stats = await seedLocalities(pg, rows);
  } finally {
    await pg.end();
  }

  const rate = stats.matchRate;
  if (rate !== null && rate < MATCH_RATE_THRESHOLD && process.env.ALLOW_LOW_MATCH !== "1") {
    console.error(
      `\nMatch-rate ${(rate * 100).toFixed(1)}% is below the ${MATCH_RATE_THRESHOLD * 100}% gate. ` +
        `Remediate before Phase 3 (inspect normalization / dedup / TERYT→enum mapping). ` +
        `Unmatched (voivodeship, city) — top ${stats.misses.length}:`,
    );
    for (const m of stats.misses) console.error(`  ${m.count}x  ${m.voivodeship ?? "∅"} / ${m.city ?? "∅"}`);
    console.error(`\nSet ALLOW_LOW_MATCH=1 to proceed anyway.`);
    process.exitCode = 1;
    return;
  }
  console.log("Done.");
}

// Run only as a CLI, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
