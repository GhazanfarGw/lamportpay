/**
 * Server-side access control for payout partner proxy routes.
 *
 * These routes can move real money once a payout partner key is provisioned, so
 * they must never be callable anonymously. Access is denied by default: a
 * request is only allowed when a `PAYOUT_OPERATOR_TOKEN` secret is configured on
 * the server AND the caller presents the exact same token in the
 * `x-payout-operator-token` header (or `Authorization: Bearer <token>`).
 *
 * The token is a server-held secret and must never be shipped to the browser.
 */

export interface PayoutAuthResult {
  /** Response to return immediately when the caller is not authorized. */
  denied: Response | null;
  /** Stable identifier for audit logs when authorized. */
  operatorId: string | null;
}

function deny(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function extractToken(request: Request): string | null {
  const headerToken = request.headers.get("x-payout-operator-token");
  if (headerToken) return headerToken.trim();

  const auth = request.headers.get("authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, "").trim();
  }
  return null;
}

/**
 * Authorize a payout API request. Returns `denied` with a ready-to-return
 * Response when the caller must be rejected.
 */
export function authorizePayoutRequest(request: Request): PayoutAuthResult {
  const expected = process.env["PAYOUT_OPERATOR_TOKEN"];

  // Deny by default. Without a configured operator token, payout proxying is
  // unavailable rather than open to the internet.
  if (!expected || expected.length < 24) {
    return {
      denied: deny(
        "Payout API access is disabled. A server-side PAYOUT_OPERATOR_TOKEN must be configured before payout requests are accepted.",
        403,
      ),
      operatorId: null,
    };
  }

  const provided = extractToken(request);
  if (!provided || provided !== expected) {
    return {
      denied: deny("Unauthorized.", 401),
      operatorId: null,
    };
  }

  return { denied: null, operatorId: "payout-operator" };
}

/** Minimal audit trail for money-moving requests (server logs only). */
export function auditPayoutAction(
  action: string,
  operatorId: string,
  details: Record<string, unknown>,
) {
  console.info(
    JSON.stringify({
      event: "payout_audit",
      action,
      operatorId,
      at: new Date().toISOString(),
      ...details,
    }),
  );
}
