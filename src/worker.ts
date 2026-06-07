import { handle } from "@astrojs/cloudflare/handler";
import { createAdminClient } from "@/lib/supabase-admin";
import { drainDueEmails, type EmailConfig } from "@/lib/email";

// Custom Worker entry (wrangler.jsonc `main`): composes the Astro fetch
// handler with a `scheduled` handler that sweeps the email outbox — same
// Worker, no second deployment. The cron (*/5) only retries stragglers; the
// immediate waitUntil attempt in sendTransactionalEmail carries the <5 min
// NFR in typical conditions.
//
// `scheduled` runs outside the request path, so astro:env/server values are
// NOT read here — the admin client and email config are built from the raw
// `env` bindings parameter (see plan "Critical Implementation Details").

interface WorkerEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
}

interface ScheduledCtx {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  fetch: handle,
  scheduled(_controller: unknown, env: WorkerEnv, ctx: ScheduledCtx) {
    const admin =
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? createAdminClient({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY })
        : null;
    if (!admin) {
      // No service-role binding — nothing to sweep. Mirrors the channel's
      // graceful no-op convention.
      // eslint-disable-next-line no-console
      console.warn("[email] cron sweep skipped — service-role env missing");
      return;
    }

    const config: EmailConfig | null =
      env.BREVO_API_KEY && env.EMAIL_FROM
        ? { apiKey: env.BREVO_API_KEY, fromEmail: env.EMAIL_FROM, fromName: env.EMAIL_FROM_NAME ?? "Zagroda Hub" }
        : null;

    // Null config is handled inside drainDueEmails (logged no-op that does
    // NOT consume the retry budget).
    ctx.waitUntil(drainDueEmails(admin, config, { limit: 25 }));
  },
};
