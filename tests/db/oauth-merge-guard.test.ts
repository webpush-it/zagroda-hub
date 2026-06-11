import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client as PgClient } from "pg";
import { inject } from "vitest";
import {
  createAdminClient,
  createOwnerClient,
  insertFacebookIdentity,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// CI-runnable stand-in for the live unverified-Facebook path that Meta App
// Review blocks (FR-018, S-07). These tests pin the `password_account_exists`
// detector's behavior across identity configurations the unit truth table
// can't reach, by constructing the exact auth.* post-states GoTrue leaves
// behind. Grants and case-insensitivity are already covered by
// password-account-exists.test.ts — no duplication here.

const PASSWORD = "test-password-123";

let admin: TypedClient;
let pg: PgClient;

beforeAll(async () => {
  admin = createAdminClient();
  pg = new PgClient({ connectionString: inject("supabaseDbUrl") });
  await pg.connect();
});

afterAll(async () => {
  await pg.end();
});

describe("oauth merge guard — collision post-state simulation", () => {
  // The split-brain state whose login the callback blocks: a password owner
  // plus a SECOND user holding an unverified `facebook` identity for the same
  // email (GoTrue never auto-links unverified emails, so no merge happens).
  it("(a) an unverified facebook identity for the same email does not mask the password account", async () => {
    const email = uniqueEmail("omg-collision");
    const { userId: passwordUserId } = await createOwnerClient(email, PASSWORD);

    const { data: oauthUser, error: createError } = await admin.auth.admin.createUser({
      email: uniqueEmail("omg-collision-oauth"),
      password: PASSWORD,
      email_confirm: true,
    });
    expect(createError).toBeNull();
    if (!oauthUser.user) throw new Error("createUser returned no user");
    const oauthUserId = oauthUser.user.id;
    // Strip the placeholder email identity so the user carries ONLY the
    // facebook identity reporting the collision email as unverified.
    await pg.query("delete from auth.identities where user_id = $1 and provider = 'email'", [oauthUserId]);
    await insertFacebookIdentity({ userId: oauthUserId, email, emailVerified: false });

    // The detector still sees the email+password identity…
    const { data, error } = await admin.rpc("password_account_exists", { p_email: email });
    expect(error).toBeNull();
    expect(data).toBe(true);

    // …and the two accounts remain distinct users (split-brain, not merge).
    const { rows } = await pg.query<{ user_id: string; provider: string }>(
      "select user_id, provider from auth.identities where lower(email) = lower($1) order by provider",
      [email],
    );
    expect(rows.map((r) => r.provider)).toEqual(["email", "facebook"]);
    expect(rows.find((r) => r.provider === "email")?.user_id).toBe(passwordUserId);
    expect(rows.find((r) => r.provider === "facebook")?.user_id).toBe(oauthUserId);
    expect(passwordUserId).not.toBe(oauthUserId);
  });
});

describe("oauth merge guard — OAuth-only boundary (gap #3)", () => {
  // Documents the detector's deliberate boundary: it answers "does a PASSWORD
  // account exist", so an OAuth-only user is invisible to it — an unverified
  // facebook login colliding with a Google-only account still passes (v2).
  it("(b) returns false for a user whose only identity is facebook", async () => {
    const email = uniqueEmail("omg-oauth-only");
    const { data: user, error: createError } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(createError).toBeNull();
    if (!user.user) throw new Error("createUser returned no user");
    const userId = user.user.id;
    await pg.query("delete from auth.identities where user_id = $1 and provider = 'email'", [userId]);
    await insertFacebookIdentity({ userId, email, emailVerified: true });

    const { rows } = await pg.query<{ provider: string }>("select provider from auth.identities where user_id = $1", [
      userId,
    ]);
    expect(rows.map((r) => r.provider)).toEqual(["facebook"]);

    const { data, error } = await admin.rpc("password_account_exists", { p_email: email });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });
});

describe("oauth merge guard — scenario-B probe (pre-registration attack)", () => {
  // Attacker pre-registers the victim's email with a password but never
  // confirms it. The detector checks identity EXISTENCE, not confirmation —
  // so the victim's later unverified-provider login is blocked even before
  // the attacker confirms.
  it("(c) returns true for an UNCONFIRMED password account", async () => {
    const email = uniqueEmail("omg-unconfirmed");
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: false,
    });
    expect(createError).toBeNull();

    const { data, error } = await admin.rpc("password_account_exists", { p_email: email });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });
});
