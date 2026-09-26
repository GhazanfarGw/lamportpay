/**
 * Shared helpers for the end-to-end API suite.
 *
 * The suite runs against a running server (dev server by default) and never
 * uses real funds: only read-only Jupiter previews/orders and mock payout partner
 * fallbacks are exercised. No transaction is ever signed or executed.
 */

export const BASE_URL = process.env["E2E_BASE_URL"] ?? "http://localhost:8080";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Well-known burn address — valid base58, used only as a routing taker. */
export const TEST_TAKER = "11111111111111111111111111111111";

export const MIN_LAMPORTS = "1000000"; // 0.001 SOL
export const MAX_LAMPORTS = "10000000"; // 0.01 SOL

export type ApiResult<T = Record<string, unknown>> = {
  status: number;
  body: T;
  raw: string;
};

export async function api<T = Record<string, unknown>>(
  path: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<ApiResult<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    ...(init?.body !== undefined
      ? { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) }
      : {}),
  });
  const raw = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = {};
  }
  return { status: res.status, body: body as T, raw };
}

export type IntegrationStatus = {
  providers: Array<{ name: string; configured: boolean; mode: "sandbox" | "mock" }>;
  endpoints: Array<{ path: string; provider: string; mode: string }>;
};

export async function getIntegrationStatus() {
  const res = await api<IntegrationStatus>("/api/integration-status");
  if (res.status !== 200) {
    throw new Error(`integration-status unavailable (${res.status}): ${res.raw.slice(0, 200)}`);
  }
  return res.body;
}

export function providerMode(status: IntegrationStatus, name: string) {
  return status.providers.find((p) => p.name === name)?.mode ?? "mock";
}

/** Any string that must never appear in an API response. */
export const SECRET_LEAK_PATTERNS = [
  /x-api-key/i,
  /JUPITER_API_KEY\s*[:=]\s*\S/i,
  /PAYOUT_API_KEY\s*[:=]\s*\S/i,
  /\bsk_live\b/i,
];

export function assertNoSecretLeak(raw: string) {
  for (const pattern of SECRET_LEAK_PATTERNS) {
    if (pattern.test(raw)) {
      throw new Error(`Response appears to leak a secret (matched ${pattern}).`);
    }
  }
}
