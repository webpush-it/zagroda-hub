import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inject } from "vitest";
import type { Database } from "../../src/db/database.types";

// Single place for client creation (admin/service_role, authed owner, anon)
// and fixtures (owner + zagroda + turnusy + booking requests). Credentials
// come from global-setup via inject().

export type TypedClient = SupabaseClient<Database>;

// Tests are short-lived scripts — no session persistence or token refresh.
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

export function createAdminClient(): TypedClient {
  return createClient<Database>(inject("supabaseUrl"), inject("supabaseServiceRoleKey"), clientOptions);
}

export function createAnonClient(): TypedClient {
  return createClient<Database>(inject("supabaseUrl"), inject("supabaseAnonKey"), clientOptions);
}

/** Fresh client signed in as an EXISTING user (e.g. a second, independent session). */
export async function createSignedInClient(email: string, password: string): Promise<TypedClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signInWithPassword failed for ${email}: ${error.message}`);
  return client;
}

/** Creates a new confirmed user (admin API) and returns a signed-in client. */
export async function createOwnerClient(
  email: string,
  password: string,
): Promise<{ client: TypedClient; userId: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`auth.admin.createUser failed for ${email}: ${error.message}`);
  const client = await createSignedInClient(email, password);
  return { client, userId: data.user.id };
}

export function uniqueEmail(prefix = "owner"): string {
  return `${prefix}-${randomUUID()}@test.local`;
}

export interface SeedZagrodaOptions {
  ownerId: string;
  dailyLimit: number;
  name?: string;
  /** Number of turnusy to create (sequential one-hour slots from 08:00). Default 1. */
  turnusCount?: number;
}

export interface SeededZagroda {
  zagrodaId: string;
  turnusIds: string[];
}

/** Seeds a zagroda with its turnusy via the service-role client (bypasses RLS). */
export async function seedZagroda(admin: TypedClient, opts: SeedZagrodaOptions): Promise<SeededZagroda> {
  const { data: zagroda, error: zagrodaError } = await admin
    .from("zagrody")
    .insert({ owner_id: opts.ownerId, name: opts.name ?? "Testowa Zagroda", daily_limit: opts.dailyLimit })
    .select("id")
    .single();
  if (zagrodaError) throw new Error(`seedZagroda: zagroda insert failed: ${zagrodaError.message}`);

  const turnusCount = opts.turnusCount ?? 1;
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
      guest_name: "Jan Testowy",
      guest_email: "jan@szkola.test",
      guest_phone: "+48 600 000 000",
    })
    .select("id")
    .single();
  if (error) throw new Error(`seedBookingRequest failed: ${error.message}`);
  return data.id;
}
