/**
 * Test fixtures for TEST / LIVE mode. Tests that exercise real-funds logic
 * (live funding, swaps) must opt into a COMPLETE live configuration and mock
 * the code lock open (vi.mock("@/lib/app-mode-lock", ...)); nothing here is
 * used by the app.
 */
export const LIVE_ENV = {
  LAMPORTPAY_MODE: "live",
  LAMPORTPAY_LIVE_APPROVED_BY: "owner (test fixture)",
  LAMPORTPAY_LIVE_APPROVED_AT: "2026-10-01T00:00:00Z",
  LAMPORTPAY_LIVE_URL: "https://app.lamportpay.test",
  SOLANA_RPC_URL: "https://rpc.fixture.example",
  SUPABASE_URL: "https://prodfixture.supabase.co",
  STABLES_API_KEY: "sti_live_fixture",
  STABLES_API_URL: "https://api.stables.money",
} as const;

export const TEST_ENV = {
  LAMPORTPAY_MODE: "test",
  STABLES_API_KEY: "sti_test_fixture",
  STABLES_API_URL: "https://api.sandbox.stables.money",
} as const;

export const MODE_ENV_KEYS = [...new Set([...Object.keys(LIVE_ENV), ...Object.keys(TEST_ENV)])];
