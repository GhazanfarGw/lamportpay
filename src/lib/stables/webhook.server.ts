/**
 * Stables webhook signature verification for dashboard-managed endpoints
 * (Svix): `svix-id`, `svix-timestamp`, `svix-signature` headers; HMAC-SHA256
 * over `{id}.{timestamp}.{body}` keyed with the base64 part of the endpoint's
 * `whsec_…` secret, base64-encoded. Deliveries without Svix headers (such as
 * API-managed subscriptions signing with X-Webhook-Signature) are refused.
 *
 * Always verify against the raw request body, before parsing it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export type WebhookVerification = { ok: true } | { ok: false; reason: string };

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Whether a request carries the Svix headers at all (checked before any secret is needed). */
export function hasSvixHeaders(headers: Headers): boolean {
  return Boolean(
    headers.get("svix-id") && headers.get("svix-timestamp") && headers.get("svix-signature"),
  );
}

export function verifyStablesWebhook(
  rawBody: string,
  headers: Headers,
  secret: string,
  nowMs: number = Date.now(),
): WebhookVerification {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, reason: "Missing svix signature headers." };
  }

  const ts = Number(timestamp);
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(ts)) {
    return { ok: false, reason: "Invalid svix-timestamp." };
  }
  if (Math.abs(nowMs / 1000 - ts) > SVIX_TOLERANCE_SECONDS) {
    return { ok: false, reason: "Webhook timestamp is outside the allowed window." };
  }

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();

  for (const entry of signatureHeader.split(" ")) {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) continue;
    if (safeEqual(Buffer.from(signature, "base64"), expected)) return { ok: true };
  }
  return { ok: false, reason: "Invalid webhook signature." };
}
