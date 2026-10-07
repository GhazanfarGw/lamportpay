/**
 * Security headers added to every server response (src/server.ts).
 *
 * Deliberately no script/style/connect CSP yet: the wallet adapters, Supabase,
 * Solana RPC and Stables' hosted KYC would need a full allowlist and a
 * report-only trial first (pre-LIVE checklist item). The directives below
 * restrict nothing the app loads; they stop framing (clickjacking of the
 * payment and admin pages), plugin content and base-URL hijacking.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy":
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  // Wallet extensions and Solflare's web wallet use popups; keep them working.
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  // Browsers ignore HSTS over plain http (local development).
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
};

/** The response with the security headers set (existing values are kept). */
export function withSecurityHeaders(response: Response): Response {
  const missing = Object.entries(SECURITY_HEADERS).filter(([k]) => !response.headers.has(k));
  if (missing.length === 0) return response;
  try {
    for (const [k, v] of missing) response.headers.set(k, v);
    return response;
  } catch {
    // Immutable headers (e.g. a proxied fetch response): copy into a new response.
    const headers = new Headers(response.headers);
    for (const [k, v] of missing) headers.set(k, v);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
