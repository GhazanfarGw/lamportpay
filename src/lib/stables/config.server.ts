/**
 * Stables configuration. Server-side only: the API key and webhook secret must
 * never reach the browser. Read inside handlers so env changes apply per call.
 */

export const STABLES_SANDBOX_URL = "https://api.sandbox.stables.money";

export type StablesEnvironment = "sandbox" | "production";

export type StablesConfig =
  | { configured: true; apiKey: string; apiUrl: string; environment: StablesEnvironment }
  | { configured: false; reason: string };

export function getStablesConfig(): StablesConfig {
  const apiKey = process.env["STABLES_API_KEY"]?.trim();
  const apiUrl = (process.env["STABLES_API_URL"]?.trim() || STABLES_SANDBOX_URL).replace(
    /\/+$/,
    "",
  );

  if (!apiKey) return { configured: false, reason: "STABLES_API_KEY is not set." };

  let host: string;
  try {
    const url = new URL(apiUrl);
    if (url.protocol !== "https:")
      return { configured: false, reason: "STABLES_API_URL must use HTTPS." };
    host = url.host;
  } catch {
    return { configured: false, reason: "STABLES_API_URL is not a valid URL." };
  }

  const environment: StablesEnvironment = host.includes("sandbox") ? "sandbox" : "production";

  // Keys are prefixed per environment. A mismatch means the key would be
  // rejected at best, or a live key pointed somewhere unexpected at worst.
  if (apiKey.startsWith("sti_test_") && environment === "production") {
    return {
      configured: false,
      reason: "A sandbox key (sti_test_) is set with a production STABLES_API_URL.",
    };
  }
  if (apiKey.startsWith("sti_live_") && environment === "sandbox") {
    return {
      configured: false,
      reason: "A live key (sti_live_) is set with the sandbox STABLES_API_URL.",
    };
  }

  return { configured: true, apiKey, apiUrl, environment };
}

/** Signing secret (`whsec_…`) of the dashboard-managed (Svix) webhook endpoint. */
export function getStablesWebhookSecret(): string | null {
  return process.env["STABLES_WEBHOOK_SECRET"]?.trim() || null;
}
