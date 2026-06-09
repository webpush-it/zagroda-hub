import { beforeAll, describe, expect, it } from "vitest";
import {
  createAdminClient,
  createAnonClient,
  createOwnerClient,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// Proof of the FR-018 collision detector before the OAuth callback relies on it:
// it is SECURITY DEFINER (reads auth.identities) but locked to service_role, so
// anon/authenticated must be denied EXECUTE; and it must report true only for an
// existing email+password ("email" provider) identity, case-insensitively.

const PASSWORD = "test-password-123";

let admin: TypedClient;
let anon: TypedClient;
let authed: TypedClient;
let ownerEmail: string;

beforeAll(async () => {
  admin = createAdminClient();
  anon = createAnonClient();
  ownerEmail = uniqueEmail("pae-owner");
  // createOwnerClient → admin.createUser with email+password → an 'email' identity.
  const created = await createOwnerClient(ownerEmail, PASSWORD);
  authed = created.client;
});

describe("password_account_exists — locked to service_role", () => {
  it("(a) anon and authenticated are denied EXECUTE", async () => {
    for (const client of [anon, authed]) {
      const { error } = await client.rpc("password_account_exists", { p_email: ownerEmail });
      expect(error?.code).toBe("42501"); // permission denied for function
    }
  });
});

describe("password_account_exists — detection", () => {
  it("(b) returns true for an existing email+password account", async () => {
    const { data, error } = await admin.rpc("password_account_exists", { p_email: ownerEmail });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it("(c) is case-insensitive on the email", async () => {
    const { data, error } = await admin.rpc("password_account_exists", { p_email: ownerEmail.toUpperCase() });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it("(d) returns false for an address with no password account", async () => {
    const { data, error } = await admin.rpc("password_account_exists", { p_email: uniqueEmail("pae-absent") });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });
});
