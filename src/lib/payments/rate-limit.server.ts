/**
 * Small fixed-window rate limiter for public, read-only endpoints (the /pay
 * calculator and wallet balances). Keyed by signed-in user id, else by client
 * IP. In memory, per server instance: it stops casual abuse of the partner APIs
 * but is not a global limit — the platform-wide limiter is C35 / S34 (Phase 4).
 */
const windows = new Map<string, { start: number; count: number }>();

export function clientKey(request: Request, userId: string | null): string {
  if (userId) return `u:${userId}`;
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip =
    fwd || request.headers.get("x-real-ip") || request.headers.get("cf-connecting-ip") || "unknown";
  return `ip:${ip}`;
}

/** True when the call is allowed; false when `key` used up `limit` calls in `windowMs`. */
export function allow(bucket: string, key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const id = `${bucket}|${key}`;
  const w = windows.get(id);
  if (!w || now - w.start >= windowMs) {
    windows.set(id, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return true;
  }
  if (w.count >= limit) return false;
  w.count += 1;
  return true;
}

/** For tests. */
export function resetRateLimits(): void {
  windows.clear();
}
