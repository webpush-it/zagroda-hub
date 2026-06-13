// Selective fetch mock for the Brevo send edge. Integration tests drive the
// real `drainDueEmails` claim->send->mark loop against local Supabase, so a
// global fetch stub is out — supabase-js uses `fetch` internally and would
// break. This wrapper intercepts ONLY `https://api.brevo.com/...` and delegates
// every other request to the captured real `globalThis.fetch`, so supabase-js
// traffic passes through untouched.
//
// Contract mirrors `sendViaBrevo` (src/lib/email/brevo.ts): the returned
// Response exposes `.ok`, `.status`, `.text()`, and `.json()` -> { messageId? }.
// Always restore in `afterEach` — `fileParallelism: false` means files share a
// process and a leaked stub silently breaks later files.

const BREVO_HOST = "api.brevo.com";

type QueuedResponse = { kind: "respond"; status: number; body: string } | { kind: "reject"; error: Error };

export interface BrevoRequestRecord {
  url: string;
  /** Parsed JSON request body, or null when it wasn't a JSON string. */
  body: Record<string, unknown> | null;
}

export interface BrevoMock {
  /** Queue a 2xx response carrying a `messageId` (the happy path). */
  mockSuccess(messageId?: string, status?: number): BrevoMock;
  /** Queue a 2xx response with NO `messageId` (empty-id oracle, `brevo.ts:45`). */
  mockSuccessNoMessageId(status?: number): BrevoMock;
  /** Queue a non-2xx response with a body (generic provider failure). */
  mockFailure(status: number, body?: string): BrevoMock;
  /** Queue a thrown network error (exercises `sendViaBrevo`'s catch, `brevo.ts:48`). */
  mockReject(error?: Error): BrevoMock;
  /** Brevo requests observed, in arrival order (count + parsed bodies). */
  readonly requests: BrevoRequestRecord[];
  /** Number of Brevo requests observed. */
  readonly count: number;
  /** Restore the original `globalThis.fetch`. Call in `afterEach`. */
  restore(): void;
}

/** True only for absolute URLs whose host is exactly `api.brevo.com`. */
function isBrevoUrl(url: string): boolean {
  try {
    return new URL(url).host === BREVO_HOST;
  } catch {
    // Relative/garbage URL — never a Brevo call, delegate to real fetch.
    return false;
  }
}

/** Normalize fetch's first arg: it may be a string, a URL, or a Request. */
function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
}

function parseJsonBody(init?: RequestInit): Record<string, unknown> | null {
  if (init && typeof init.body === "string") {
    try {
      return JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Install the selective Brevo edge mock. Queue responses with the `mock*`
 * methods (FIFO, one dequeued per Brevo call); all other requests reach the
 * real fetch. An unqueued Brevo call throws rather than hitting the network.
 */
export function installBrevoMock(): BrevoMock {
  const realFetch = globalThis.fetch;
  const queue: QueuedResponse[] = [];
  const requests: BrevoRequestRecord[] = [];

  const wrapper = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    if (!isBrevoUrl(url)) {
      return realFetch(input, init);
    }

    requests.push({ url, body: parseJsonBody(init) });

    const next = queue.shift();
    if (!next) {
      throw new Error(`installBrevoMock: no queued response for Brevo request #${requests.length} (${url})`);
    }
    if (next.kind === "reject") {
      throw next.error;
    }
    return new Response(next.body, { status: next.status });
  }) as typeof globalThis.fetch;

  globalThis.fetch = wrapper;

  const mock: BrevoMock = {
    mockSuccess(messageId = "<brevo-msg>", status = 201) {
      queue.push({ kind: "respond", status, body: JSON.stringify({ messageId }) });
      return mock;
    },
    mockSuccessNoMessageId(status = 201) {
      queue.push({ kind: "respond", status, body: JSON.stringify({}) });
      return mock;
    },
    mockFailure(status, body = "") {
      queue.push({ kind: "respond", status, body });
      return mock;
    },
    mockReject(error = new Error("network down")) {
      queue.push({ kind: "reject", error });
      return mock;
    },
    requests,
    get count() {
      return requests.length;
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };

  return mock;
}
