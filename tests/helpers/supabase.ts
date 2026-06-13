import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
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

/**
 * Creates a signed-in owner whose e-mail is NOT verified.
 *
 * Mechanism: create confirmed -> sign in -> clear email_confirmed_at via
 * direct SQL. The session stays valid (the FR-006 gate reads auth.users,
 * not the JWT), and the fixture keeps working after S-01 phase 2 flips
 * `enable_confirmations = true` (unconfirmed users can no longer sign in,
 * so `email_confirm: false` + signIn would break).
 */
export async function createUnverifiedOwnerClient(
  email: string,
  password: string,
): Promise<{ client: TypedClient; userId: string }> {
  const { client, userId } = await createOwnerClient(email, password);
  const pg = new PgClient({ connectionString: inject("supabaseDbUrl") });
  await pg.connect();
  try {
    await pg.query("update auth.users set email_confirmed_at = null where id = $1", [userId]);
  } finally {
    await pg.end();
  }
  return { client, userId };
}

/**
 * Clears email_confirmed_at for an existing user via direct SQL.
 *
 * The HTTP-surface harness needs the unverified state AFTER a genuine cookie
 * signin: create confirmed -> signInOwnerHttp (jar gets cookies) -> clear here
 * -> call the route. Clearing before signin breaks (GoTrue blocks unconfirmed
 * signins once confirmations are on — see createUnverifiedOwnerClient). The
 * FR-006 gate reads auth.users fresh via getUser(), so the session stays valid
 * and the gate still sees the cleared state.
 */
export async function clearEmailConfirmation(userId: string): Promise<void> {
  const pg = new PgClient({ connectionString: inject("supabaseDbUrl") });
  await pg.connect();
  try {
    await pg.query("update auth.users set email_confirmed_at = null where id = $1", [userId]);
  } finally {
    await pg.end();
  }
}

/**
 * Inserts a `facebook` identity row for an existing user via direct SQL —
 * simulating the post-handshake state GoTrue leaves after an OAuth login
 * (Meta App Review blocks producing the unverified variant live).
 *
 * `auth.identities.email` is a GENERATED column (from identity_data->>'email'),
 * so it must NOT be inserted; `provider_id` is NOT NULL and part of the
 * `(provider, provider_id)` unique key, so a fresh uuid stands in for the
 * provider's `sub`.
 */
export async function insertFacebookIdentity(opts: {
  userId: string;
  email: string;
  emailVerified: boolean;
}): Promise<void> {
  const pg = new PgClient({ connectionString: inject("supabaseDbUrl") });
  await pg.connect();
  try {
    await pg.query(
      `insert into auth.identities (id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
       values (gen_random_uuid(), $1, 'facebook', $2,
               jsonb_build_object('sub', $2::text, 'email', $3::text, 'email_verified', $4::boolean),
               now(), now(), now())`,
      [opts.userId, randomUUID(), opts.email, opts.emailVerified],
    );
  } finally {
    await pg.end();
  }
}

export function uniqueEmail(prefix = "owner"): string {
  return `${prefix}-${randomUUID()}@test.local`;
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
  /** Per-test guest contact overrides — unique values make outbox rows attributable and leak assertions meaningful. */
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
