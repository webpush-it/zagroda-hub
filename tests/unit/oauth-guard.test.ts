import { describe, it, expect } from "vitest";
import { shouldBlockOAuth, isOAuthProvider } from "../../src/lib/auth/oauth-guard";

describe("shouldBlockOAuth", () => {
  it("never blocks when the provider email is verified (Google always; merge path)", () => {
    expect(shouldBlockOAuth({ emailVerified: true, passwordAccountExists: true })).toBe(false);
    expect(shouldBlockOAuth({ emailVerified: true, passwordAccountExists: false })).toBe(false);
  });

  it("blocks an unverified email colliding with an existing password account (FR-018)", () => {
    expect(shouldBlockOAuth({ emailVerified: false, passwordAccountExists: true })).toBe(true);
  });

  it("allows an unverified email with no existing password account (clean new OAuth user)", () => {
    expect(shouldBlockOAuth({ emailVerified: false, passwordAccountExists: false })).toBe(false);
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
