/**
 * Payout partner API configuration and server-side helpers.
 *
 * All secrets are read inside handler bodies. Never expose payout partner keys
 * or webhook secrets to the browser.
 */

export const PAYOUT_API_URL = "";

export interface PayoutConfig {
  apiKey: string | undefined;
  webhookSecret: string | undefined;
  apiUrl: string;
  enabled: boolean;
}

export function getPayoutConfig(): PayoutConfig {
  const apiKey = process.env["PAYOUT_API_KEY"];
  const webhookSecret = process.env["PAYOUT_WEBHOOK_SECRET"];
  const apiUrl = process.env["PAYOUT_API_URL"] || PAYOUT_API_URL;
  return {
    apiKey,
    webhookSecret,
    apiUrl,
    enabled: Boolean(apiKey && apiKey.startsWith("api_") && apiUrl),
  };
}

export function payoutHeaders(config: PayoutConfig, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    "Api-Key": config.apiKey || "",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  return headers;
}

export function payoutError(status: number, body: string) {
  return { error: `Payout partner API request failed (${status}).`, raw: body };
}
