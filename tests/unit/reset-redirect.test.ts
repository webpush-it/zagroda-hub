import { describe, it, expect } from "vitest";
import { resolveResetRedirect, RESET_MESSAGES } from "../../src/lib/auth/reset-redirect";

describe("resolveResetRedirect", () => {
  it("redirects to forgot-password when there is no recovery session", () => {
    const target = resolveResetRedirect({ hasSession: false });
    expect(target).toBe(`/auth/forgot-password?error=${encodeURIComponent(RESET_MESSAGES.expired)}`);
  });

  it("redirects to forgot-password regardless of error code when session is missing", () => {
    const target = resolveResetRedirect({ hasSession: false, errorCode: "weak_password" });
    expect(target).toBe(`/auth/forgot-password?error=${encodeURIComponent(RESET_MESSAGES.expired)}`);
  });

  it("stays on reset-password with the weak message on weak_password", () => {
    const target = resolveResetRedirect({ hasSession: true, errorCode: "weak_password" });
    expect(target).toBe(`/auth/reset-password?error=${encodeURIComponent(RESET_MESSAGES.weak)}`);
  });

  it("stays on reset-password with a generic message on any other error", () => {
    const target = resolveResetRedirect({ hasSession: true, errorCode: "over_request_rate_limit" });
    expect(target).toBe(`/auth/reset-password?error=${encodeURIComponent(RESET_MESSAGES.generic)}`);
  });

  it("redirects to dashboard on success", () => {
    expect(resolveResetRedirect({ hasSession: true, errorCode: null })).toBe("/dashboard");
    expect(resolveResetRedirect({ hasSession: true })).toBe("/dashboard");
  });
});
