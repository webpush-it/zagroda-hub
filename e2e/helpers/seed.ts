import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/db/database.types";

// Node-context port of tests/helpers/supabase.ts seed shapes for Playwright.
// Same signatures/defaults — the only difference is credential source: the
// e2e global-setup (e2e/global-setup.ts) exports E2E_SUPABASE_URL and
// E2E_SUPABASE_SERVICE_ROLE_KEY into the test-process env (inherited by forked
// workers), so we read those instead of vitest's inject(). No DB teardown:
// isolation is by unique data (unique owner email, trip_date, guest emails).

export type TypedClient = SupabaseClient<Database>;

// Tests are short-lived scripts — no session persistence or token refresh.
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — e2e/global-setup.ts must run before seeding (resolves the local stack).`);
  }
  return value;
}

/** Service-role client built from the env the e2e global-setup exported. */
export function createAdminClient(): TypedClient {
  return createClient<Database>(
    requireEnv("E2E_SUPABASE_URL"),
    requireEnv("E2E_SUPABASE_SERVICE_ROLE_KEY"),
    clientOptions,
  );
}

export function uniqueEmail(prefix = "owner"): string {
  return `${prefix}-${randomUUID()}@test.local`;
}

/** Creates a new confirmed user (admin API) so it can sign in, publish, and accept. */
export async function createConfirmedOwner(email: string, password: string): Promise<{ userId: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`auth.admin.createUser failed for ${email}: ${error.message}`);
  return { userId: data.user.id };
}

export interface SeedZagrodaOptions {
  ownerId: string;
  dailyLimit: number;
  name?: string;
  /** Number of turnusy to create (sequential one-hour slots from 08:00). Default 1 (0 allowed). */
  turnusCount?: number;
  /** Profile fields (S-01). Defaults produce a publish-complete profile. */
  description?: string | null;
  voivodeship?: Database["public"]["Enums"]["voivodeship"] | null;
  city?: string | null;
  /**
   * Seed as already published (service_role bypasses RLS and passes the
   * is_published trigger guard by design). Default false (draft).
   */
  published?: boolean;
}

export interface SeededZagroda {
  zagrodaId: string;
  turnusIds: string[];
}

/** Seeds a zagroda with its turnusy via the service-role client (bypasses RLS). */
export async function seedZagroda(admin: TypedClient, opts: SeedZagrodaOptions): Promise<SeededZagroda> {
  const { data: zagroda, error: zagrodaError } = await admin
    .from("zagrody")
    .insert({
      owner_id: opts.ownerId,
      name: opts.name ?? "Testowa Zagroda",
      daily_limit: opts.dailyLimit,
      description: opts.description === undefined ? "Zagroda testowa z programem edukacyjnym." : opts.description,
      voivodeship: opts.voivodeship === undefined ? "mazowieckie" : opts.voivodeship,
      city: opts.city === undefined ? "Płock" : opts.city,
      is_published: opts.published ?? false,
    })
    .select("id")
    .single();
  if (zagrodaError) throw new Error(`seedZagroda: zagroda insert failed: ${zagrodaError.message}`);

  const turnusCount = opts.turnusCount ?? 1;
  if (turnusCount === 0) return { zagrodaId: zagroda.id, turnusIds: [] };

  const rows = Array.from({ length: turnusCount }, (_, i) => ({
    zagroda_id: zagroda.id,
    label: `Turnus ${i + 1}`,
    start_time: `${String(8 + i).padStart(2, "0")}:00`,
    end_time: `${String(9 + i).padStart(2, "0")}:00`,
  }));
  const { data: turnusy, error: turnusError } = await admin.from("turnusy").insert(rows).select("id");
  if (turnusError) throw new Error(`seedZagroda: turnusy insert failed: ${turnusError.message}`);

  return { zagrodaId: zagroda.id, turnusIds: turnusy.map((t) => t.id) };
}

export interface SeedRequestOptions {
  zagrodaId: string;
  turnusId: string;
  tripDate: string;
  participants: number;
  status?: Database["public"]["Enums"]["request_status"];
  /** Per-test guest contact overrides — unique values make rows attributable and leak assertions meaningful. */
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
}

/** Seeds a booking request via the service-role client; any status allowed (fixtures). */
export async function seedBookingRequest(admin: TypedClient, opts: SeedRequestOptions): Promise<string> {
  const { data, error } = await admin
    .from("booking_requests")
    .insert({
      zagroda_id: opts.zagrodaId,
      turnus_id: opts.turnusId,
      trip_date: opts.tripDate,
      participants_count: opts.participants,
      status: opts.status ?? "pending",
      guest_name: opts.guestName ?? "Jan Testowy",
      guest_email: opts.guestEmail ?? "jan@szkola.test",
      guest_phone: opts.guestPhone ?? "+48 600 000 000",
    })
    .select("id")
    .single();
  if (error) throw new Error(`seedBookingRequest failed: ${error.message}`);
  return data.id;
}
