/**
 * Keep work running after the response is sent. On Vercel the platform's
 * `waitUntil` holds the function open until `task` settles (Nitro attaches it
 * to the request on the web runtime; the Node runtime exposes it through the
 * request context that `@vercel/functions` reads). Elsewhere (dev server,
 * long-lived Node) the promise simply keeps running. Callers must tolerate the
 * work being cut short anyway: persist first, and have a sweeper retry.
 */
type WaitUntil = (promise: Promise<unknown>) => void;

const VERCEL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

function findWaitUntil(request: Request): WaitUntil | undefined {
  const fromRequest = (request as Request & { waitUntil?: unknown }).waitUntil;
  if (typeof fromRequest === "function") return fromRequest as WaitUntil;
  const context = (
    globalThis as { [VERCEL_REQUEST_CONTEXT]?: { get?: () => { waitUntil?: unknown } | undefined } }
  )[VERCEL_REQUEST_CONTEXT]?.get?.();
  return typeof context?.waitUntil === "function" ? (context.waitUntil as WaitUntil) : undefined;
}

export function runAfterResponse(request: Request, task: Promise<unknown>): void {
  const guarded = task.catch((error) => console.error("[after-response] task failed", error));
  try {
    findWaitUntil(request)?.(guarded);
  } catch (error) {
    console.error("[after-response] waitUntil unavailable", error);
  }
}
