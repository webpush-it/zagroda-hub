import { describe, it, expect } from "vitest";
import { resolveOAuthVerdict, isOAuthProvider } from "../../src/lib/auth/oauth-guard";

describe("resolveOAuthVerdict", () => {
  it("always allows when the provider email is verified, regardless of the check's tri-state (Google always; merge path)", () => {
    expect(resolveOAuthVerdict({ emailVerified: true, passwordAccountExists: true })).toBe("allow");
    expect(resolveOAuthVerdict({ emailVerified: true, passwordAccountExists: false })).toBe("allow");
    expect(resolveOAuthVerdict({ emailVerified: true, passwordAccountExists: null })).toBe("allow");
  });

  it("blocks an unverified email colliding with an existing password account (FR-018)", () => {
    expect(resolveOAuthVerdict({ emailVerified: false, passwordAccountExists: true })).toBe("block_collision");
  });

  it("blocks an unverified email when the collision check could not run (fail closed)", () => {
    expect(resolveOAuthVerdict({ emailVerified: false, passwordAccountExists: null })).toBe("block_unavailable");
  });

  it("allows an unverified email with no existing password account (clean new OAuth user)", () => {
    expect(resolveOAuthVerdict({ emailVerified: false, passwordAccountExists: false })).toBe("allow");
  });
});

describe("isOAuthProvider", () => {
  it("accepts the supported providers", () => {
    expect(isOAuthProvider("google")).toBe(true);
    expect(isOAuthProvider("facebook")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isOAuthProvider("apple")).toBe(false);
    expect(isOAuthProvider("email")).toBe(false);
    expect(isOAuthProvider(undefined)).toBe(false);
  });
});
