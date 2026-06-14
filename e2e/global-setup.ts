import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Resolves the local Supabase stack once before the Playwright `webServer`
// (`wrangler dev`) starts, then:
//   1. writes `.dev.vars` so the built Worker (served by `wrangler dev`) talks
//      to the local stack — the app's server env names are SUPABASE_URL and
//      SUPABASE_KEY (the anon key), per astro.config.mjs.
//   2. exports SUPABASE_URL + the service-role key into the test-process env
//      (E2E_* names) so the Node-context seed helper (e2e/helpers/seed.ts) can
//      build an admin client. Playwright forks workers AFTER globalSetup, so
//      these env mutations are inherited by the worker processes.
//
// This mirrors the credential resolution + local-only guard in
// tests/helpers/global-setup.ts, ported out of vitest's provide/inject form.

interface StackKeys {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
}

function fromSupabaseStatus(): StackKeys | null {
  let stdout: string;
  try {
    stdout = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
  // The CLI may prefix the JSON with notices (e.g. "Stopped services: …").
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  let status: Record<string, string | undefined>;
  try {
    status = JSON.parse(stdout.slice(start, end + 1)) as Record<string, string | undefined>;
  } catch {
    return null;
  }
  if (!status.API_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY || !status.DB_URL) return null;
  return {
    url: status.API_URL,
    anonKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
    dbUrl: status.DB_URL,
  };
}

function fromEnv(): StackKeys | null {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_DB_URL) return null;
  return {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    dbUrl: SUPABASE_DB_URL,
  };
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function isLocal(urlString: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(urlString).hostname);
  } catch {
    return false;
  }
}

export default function globalSetup(): void {
  const keys = fromSupabaseStatus() ?? fromEnv();
  if (!keys) {
    throw new Error(
      "Could not resolve local Supabase stack credentials. " +
        "Start the stack with `npm run db:start`, or set SUPABASE_URL, " +
        "SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL.",
    );
  }
  // The seed path issues service-role admin writes (create users, insert rows).
  // The env fallback uses the same variable names production does, so refuse
  // anything non-local unless the caller overrides deliberately.
  if (process.env.ALLOW_REMOTE_TEST_DB !== "1" && !(isLocal(keys.url) && isLocal(keys.dbUrl))) {
    throw new Error(
      `Refusing to run e2e against a non-local Supabase stack (API: ${keys.url}). ` +
        "Set ALLOW_REMOTE_TEST_DB=1 to override deliberately.",
    );
  }

  // `wrangler dev` reads runtime secrets from `.dev.vars` (the @astrojs/cloudflare
  // adapter surfaces server env declared access:"secret" as Worker bindings).
  // Only the two the flow needs — BREVO_API_KEY stays unset so the email drain
  // no-ops (zero network egress); SUPABASE_SERVICE_ROLE_KEY is not used by the
  // Worker for these flows, so it is omitted here (seeding uses it in-process).
  try {
    writeFileSync(".dev.vars", `SUPABASE_URL=${keys.url}\nSUPABASE_KEY=${keys.anonKey}\n`, "utf8");
  } catch (cause) {
    throw new Error("Failed to write .dev.vars (wrangler dev reads runtime secrets from it).", { cause });
  }

  // Exposed to the Node-context seed helper (inherited by forked workers).
  process.env.E2E_SUPABASE_URL = keys.url;
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY = keys.serviceRoleKey;
}
