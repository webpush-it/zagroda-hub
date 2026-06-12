import { expect } from "vitest";
import type { APIContext, APIRoute } from "astro";
import { onRequest } from "../../src/middleware";
import { POST as signinPost } from "../../src/pages/api/auth/signin";

// HTTP-surface harness: build a minimal APIContext around a directly-imported
// handler and run it THROUGH the real middleware. A bare handler call leaves
// locals.user undefined — i.e. tests an anonymous world — so every route
// invocation in tests/api/ goes through runRoute().
//
// Auth is obtained by invoking the real POST /api/auth/signin handler:
// @supabase/ssr writes genuine (chunked) session cookies into the jar via
// context.cookies.set, and the jar serializes them back into the Cookie
// header of subsequent requests. Never hand-roll cookie chunking.

const BASE_URL = "http://localhost:4321";

/**
 * Backs the AstroCookies subset the handlers actually use. The @supabase/ssr
 * adapter only ever WRITES via cookies.set (src/lib/supabase.ts:18-22) —
 * reads parse the request Cookie header — so `set` plus serialization back
 * into a header is the whole contract. Cookie values are the @supabase/ssr
 * base64url chunks (header-safe), so no encoding round-trip is needed.
 */
export class CookieJar {
  private store = new Map<string, string>();

  set(name: string, value: string, _options?: unknown): void {
    this.store.set(name, value);
  }

  toCookieHeader(): string {
    return [...this.store.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

export interface ApiContextInit {
  jar?: CookieJar;
  method?: string;
  path: string;
  /** JSON-stringified unless already a string (raw passthrough for malformed-body tests). */
  body?: unknown;
  /** Takes precedence over `body` (signin uses form encoding). */
  formData?: FormData;
}

/** Builds the `{ request, url, cookies, locals, redirect }` shell handlers consume. */
export function createApiContext(init: ApiContextInit): APIContext {
  const jar = init.jar ?? new CookieJar();
  const url = new URL(init.path, BASE_URL);
  const headers = new Headers();
  const cookieHeader = jar.toCookieHeader();
  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }

  let body: BodyInit | undefined;
  if (init.formData) {
    body = init.formData;
  } else if (init.body !== undefined) {
    body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    headers.set("Content-Type", "application/json");
  }

  const context = {
    request: new Request(url, { method: init.method ?? "POST", headers, body }),
    url,
    cookies: jar,
    locals: {},
    redirect: (path: string, status = 302) => new Response(null, { status, headers: { Location: path } }),
  };
  return context as unknown as APIContext;
}

/** Composes the real middleware with the handler — the actual session path. */
export async function runRoute(handler: APIRoute, ctx: APIContext): Promise<Response> {
  const response = await onRequest(ctx, () => Promise.resolve(handler(ctx)));
  return response as Response;
}

/**
 * Signs in through the real signin handler so the jar receives genuine
 * session cookies. Both success and failure respond with a redirect — only
 * `/dashboard` means a session exists, so anything else throws loudly
 * instead of letting tests proceed unauthenticated.
 */
export async function signInOwnerHttp(jar: CookieJar, email: string, password: string): Promise<void> {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", password);
  const ctx = createApiContext({ jar, method: "POST", path: "/api/auth/signin", formData });
  const response = await signinPost(ctx);
  const location = response.headers.get("Location");
  if (location !== "/dashboard") {
    throw new Error(`signInOwnerHttp: expected redirect to /dashboard, got ${location ?? "<no Location>"}`);
  }
}

/**
 * The contact-data non-exposure invariant (risk #4): no API response may ever
 * echo the stored guest contact fields. Applied to every response asserted in
 * the tests/api/ suites, not just the authz file.
 */
export function assertNoContactData(responseBody: string, contact: { guest_email: string; guest_phone: string }): void {
  expect(responseBody).not.toContain(contact.guest_email);
  expect(responseBody).not.toContain(contact.guest_phone);
}
