// Cloudflare runtime helpers shared by API routes (submit, accept, reject).

/** Cloudflare's `ctx.waitUntil` when reachable (Astro v6 exposes it as locals.cfContext). */
export function getWaitUntil(locals: App.Locals): ((promise: Promise<unknown>) => void) | undefined {
  const ctx = (locals as { cfContext?: { waitUntil?: (p: Promise<unknown>) => void } }).cfContext;
  const waitUntil = ctx?.waitUntil;
  if (typeof waitUntil !== "function") return undefined;
  return (p) => {
    waitUntil.call(ctx, p);
  };
}
