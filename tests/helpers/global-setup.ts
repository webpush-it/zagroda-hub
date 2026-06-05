import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";

// Stack credentials resolved once per test run and exposed to tests via
// vitest's provide/inject. Primary source: `supabase status -o json` (works
// identically on a dev machine and in CI — no key export step anywhere).
// Fallback: env vars, for environments where the CLI is not on the path.

declare module "vitest" {
  export interface ProvidedContext {
    supabaseUrl: string;
    supabaseAnonKey: string;
    supabaseServiceRoleKey: string;
    supabaseDbUrl: string;
  }
}

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

export default function setup(project: TestProject): void {
  const keys = fromSupabaseStatus() ?? fromEnv();
  if (!keys) {
    throw new Error(
      "Could not resolve local Supabase stack credentials. " +
        "Start the stack with `npm run db:start`, or set SUPABASE_URL, " +
        "SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL.",
    );
  }
  project.provide("supabaseUrl", keys.url);
  project.provide("supabaseAnonKey", keys.anonKey);
  project.provide("supabaseServiceRoleKey", keys.serviceRoleKey);
  project.provide("supabaseDbUrl", keys.dbUrl);
}
