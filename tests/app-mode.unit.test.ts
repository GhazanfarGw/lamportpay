/**
 * TEST MODE / LIVE MODE separation. No network: fetch is stubbed and must not
 * be called when a mode forbids an endpoint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", async () => {
  const { createFakeSupabase } = await import("./support/fake-supabase");
  return { supabaseAdmin: createFakeSupabase() };
});

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { LIVE_MODE_CODE_UNLOCKED } from "@/lib/app-mode-lock";
import { modeIndicator, type ModeStatus } from "@/lib/app-mode";
import {
  ModeGuardError,
  assertEndpointAllowed,
  currentMode,
  endpointAllowed,
  evaluateMode,
  requireModeProfile,
  requireRealFundsMode,
} from "@/lib/app-mode.server";
import { executeOrder, getOrder } from "@/lib/jupiter/client.server";
import * as auth from "@/lib/payments/auth.server";
import * as settlement from "@/lib/payments/settlement.server";
import { Route as QuoteRoute } from "@/routes/api/jupiter/quote";
import { rpc } from "@/lib/solana-rpc.server";
import * as stables from "@/lib/stables/client.server";
import { getStablesConfig } from "@/lib/stables/config.server";
import { SOL_MINT, USDC_MINT } from "@/lib/tokens";
import { Route as StatusRoute } from "@/routes/api/integration-status";
import { Route as SwitchRoute } from "@/routes/api/mode/switch-request";
import { LIVE_ENV, TEST_ENV } from "./support/app-mode";

type Handler = (ctx: { request: Request }) => Promise<Response>;
const handler = (route: unknown, method: "GET" | "POST") =>
  (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers[
    method
  ]!;

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const fetchMock = vi.fn<typeof fetch>();
const db = supabaseAdmin as unknown as {
  table: (n: string) => Record<string, unknown>[];
  reset: () => void;
};

/** Jupiter's read-only order response (shape recorded from the live API, 3 Oct 2026). */
function jupiterQuote() {
  return Response.json({
    swapType: "aggregator",
    inAmount: "50000000",
    outAmount: "5901574",
    otherAmountThreshold: "5901574",
    swapMode: "ExactIn",
    slippageBps: 0,
    priceImpactPct: "0.0004491932048602912",
    routePlan: [{ percent: 100, swapInfo: { label: "GoonFi V2" } }],
    feeMint: SOL_MINT,
    feeBps: 2,
    platformFee: { feeBps: 2, feeMint: SOL_MINT },
    gasless: false,
    taker: null,
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    router: "metis",
    requestId: "01a0f537-9998-746d-addb-d11d68658ca5",
    mode: "ultra",
  });
}

function useEnv(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

beforeEach(() => {
  db.reset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("JUPITER_API_KEY", "test-key");
  vi.stubEnv("LAMPORTPAY_MODE", "");
  vi.stubEnv("SUPABASE_URL", "https://gdksfksypkcfiohozzsx.supabase.co");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- 1

describe("1. TEST MODE cannot call production endpoints", () => {
  beforeEach(() => useEnv(TEST_ENV));

  it("is the default mode", () => {
    vi.stubEnv("LAMPORTPAY_MODE", "");
    expect(currentMode()).toMatchObject({ mode: "test", ok: true, realFunds: false });
  });

  it("refuses every production payment endpoint by rule", () => {
    expect(endpointAllowed("test", "stables", "https://api.stables.money/api/v1/quotes").ok).toBe(
      false,
    );
    expect(endpointAllowed("test", "solana_rpc", "https://api.mainnet-beta.solana.com").ok).toBe(
      false,
    );
    expect(
      endpointAllowed("test", "jupiter_order", "https://api.jup.ag/swap/v2/order", {
        withWallet: true,
      }).ok,
    ).toBe(false);
    expect(
      endpointAllowed("test", "jupiter_execute", "https://api.jup.ag/swap/v2/execute").ok,
    ).toBe(false);
    // Allowed: the Stables sandbox, devnet, and Jupiter's read-only price quote
    // (no wallet: no transaction is built, nothing can be signed or moved).
    expect(endpointAllowed("test", "stables", "https://api.sandbox.stables.money").ok).toBe(true);
    expect(endpointAllowed("test", "solana_rpc", "https://api.devnet.solana.com").ok).toBe(true);
    expect(endpointAllowed("test", "jupiter_quote", "https://api.jup.ag/swap/v2/order").ok).toBe(
      true,
    );
  });

  it("reads Jupiter's real price (read-only) but never builds a swap for a wallet", async () => {
    fetchMock.mockResolvedValueOnce(jupiterQuote());
    const order = await getOrder({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: 50_000_000n,
    });
    expect(order).toMatchObject({ outAmount: 5_901_574n, feeBps: 2, transaction: null });
    const [url] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.has("taker")).toBe(false);

    fetchMock.mockClear();
    await expect(
      getOrder({ inputMint: SOL_MINT, outputMint: USDC_MINT, amount: 50_000_000n, taker: WALLET }),
    ).rejects.toBeInstanceOf(ModeGuardError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the /api/jupiter/quote preview returns Jupiter's real answer (no taker)", async () => {
    vi.spyOn(auth, "authenticateUser").mockResolvedValue({
      denied: null,
    } as unknown as Awaited<ReturnType<typeof auth.authenticateUser>>);
    fetchMock.mockResolvedValueOnce(jupiterQuote());
    const res = await handler(
      QuoteRoute,
      "POST",
    )({
      request: new Request("http://x/api/jupiter/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputMint: SOL_MINT, outputMint: USDC_MINT, amount: "5000000" }),
      }),
    });
    expect(res.status).toBe(200);
    const [url] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.has("taker")).toBe(false);
  });

  it("the /pay calculator prices SOL with Jupiter's real quote (no invented fee)", async () => {
    vi.spyOn(settlement, "priceCandidates").mockResolvedValue({
      candidates: [{ coin: "usdc", verdict: "out_of_limits", reason: "fixture" }],
    } as unknown as Awaited<ReturnType<typeof settlement.priceCandidates>>);
    fetchMock.mockResolvedValueOnce(jupiterQuote());
    const { liveEstimate } = await import("@/lib/payments/live-estimate.server");
    const est = await liveEstimate({
      amount: "0.05",
      country: "in",
      currency: "INR",
      coin: "usdc",
      withSol: true,
      payWith: "sol",
    });
    // The SOL buys what Jupiter says; that USDC is what the user sends.
    expect(est).toMatchObject({
      payWith: "sol",
      solAmount: "0.05",
      amount: "5.901574",
      sol: {
        status: "quoted",
        direction: "exact_in",
        solIn: "0.05",
        coinOut: "5.901574",
        jupiterFeeBps: 2,
        jupiterFeeMint: "sol",
        network: "mainnet",
      },
    });
    const jupiterCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("jup.ag"));
    expect(jupiterCalls).toHaveLength(1);
    expect(new URL(String(jupiterCalls[0]![0])).searchParams.has("taker")).toBe(false);
  });

  it("enforces the 15–5,000 USDC TEST MODE limit on the server", async () => {
    const { getBusinessSettings, clearBusinessSettingsCache } =
      await import("@/lib/business-settings.server");
    clearBusinessSettingsCache();
    const settings = await getBusinessSettings();
    expect(settings.paymentLimits.usdc).toEqual({ min: "15", max: "5000" });
    expect(settings.sources.paymentLimits.usdc).toBe("test_mode");

    const { liveEstimate } = await import("@/lib/payments/live-estimate.server");
    const estimateFor = (amount: string) =>
      liveEstimate({ amount, country: "in", currency: "INR", coin: "usdc", withSol: false });
    const stablesCalls = () =>
      fetchMock.mock.calls.filter(([u]) => String(u).includes("stables")).length;
    fetchMock.mockImplementation(async () =>
      Response.json({ message: "sandbox fixture" }, { status: 422 }),
    );
    for (const ok of ["15", "15.01", "100", "5000"]) {
      const before = stablesCalls();
      const est = await estimateFor(ok);
      // Within the limit: Stables (sandbox) is asked to price it.
      expect(stablesCalls()).toBe(before + 1);
      expect(est.payout.status === "refused" ? est.payout.reason : "").not.toMatch(/between 15 and/);
    }
    for (const over of ["14.99", "5000.01"]) {
      const before = stablesCalls();
      const est = await estimateFor(over);
      expect(est.payout).toEqual({
        status: "refused",
        reason: "Payments must be between 15 and 5,000 USDC.",
      });
      expect(stablesCalls()).toBe(before);
    }
  });

  it("does not change the LIVE limits", async () => {
    const { withModeLimits, resolveBusinessSettings } =
      await import("@/lib/business-settings.server");
    const stored = resolveBusinessSettings(null);
    expect(withModeLimits(stored, "live")).toBe(stored);
    expect(withModeLimits(stored, "test").paymentLimits.usdc).toEqual({ min: "15", max: "5000" });
    expect(stored.paymentLimits.usdc).not.toEqual({ min: "15", max: "5000" });
  });

  it("a LIVE request that fails its gates never reaches Jupiter either", async () => {
    useEnv({ ...LIVE_ENV }); // code lock closed → LIVE is not active
    await expect(
      getOrder({ inputMint: SOL_MINT, outputMint: USDC_MINT, amount: 1_000_000n }),
    ).rejects.toBeInstanceOf(ModeGuardError);
    expect(fetchMock).not.toHaveBeenCalled();
    // Only a fully active LIVE MODE (lock open + approval + production config) passes.
    const active = evaluateMode({ ...LIVE_ENV }, true);
    expect(() =>
      assertEndpointAllowed("jupiter_quote", "https://api.jup.ag/swap/v2/order", {}, active),
    ).not.toThrow();
  });

  it("never sends a Solana mainnet RPC request", async () => {
    const res = await rpc("mainnet-beta", "getBalance", [WALLET]);
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never calls the production Stables API, even with a production config object", async () => {
    expect(getStablesConfig()).toMatchObject({ configured: true, environment: "sandbox" });
    vi.stubEnv("STABLES_API_URL", "https://api.stables.money");
    expect(getStablesConfig()).toMatchObject({ configured: false });
    // Even a hand-made production config is refused before any request.
    await expect(
      stables.getCustomer(
        {
          configured: true,
          apiKey: "sti_live_x",
          apiUrl: "https://api.stables.money",
          environment: "production",
        },
        "cus_1",
      ),
    ).rejects.toBeInstanceOf(ModeGuardError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never builds or relays a Jupiter swap (mainnet money)", async () => {
    await expect(
      getOrder({ inputMint: SOL_MINT, outputMint: USDC_MINT, amount: 1_000_000n, taker: WALLET }),
    ).rejects.toBeInstanceOf(ModeGuardError);
    await expect(
      executeOrder({ signedTransaction: "AAAA", requestId: "req-1" }),
    ).rejects.toBeInstanceOf(ModeGuardError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes moving real funds impossible", () => {
    expect(() => requireRealFundsMode()).toThrow(
      expect.objectContaining({ code: "test_mode_no_real_funds" }),
    );
  });

  it("blocks when its configuration points at production (no silent fallback)", () => {
    vi.stubEnv("STABLES_API_URL", "https://api.stables.money");
    expect(currentMode()).toMatchObject({ mode: "test", ok: false });
    expect(() => requireModeProfile()).toThrow(
      expect.objectContaining({ status: 503, code: "mode_blocked" }),
    );
    vi.stubEnv("STABLES_API_URL", "https://api.sandbox.stables.money");
    vi.stubEnv("SUPABASE_URL", "https://zmcbnknjatrfwrcfvtzt.supabase.co");
    expect(currentMode().ok).toBe(false);
  });

  it("blocks on an unknown mode value instead of guessing", () => {
    vi.stubEnv("LAMPORTPAY_MODE", "production");
    expect(currentMode()).toMatchObject({ mode: "test", ok: false });
  });
});

// ---------------------------------------------------------------- 2

describe("2. LIVE MODE cannot use test credentials or test assets", () => {
  it("is blocked by a Stables test key or the sandbox", () => {
    const withTestKey = evaluateMode({ ...LIVE_ENV, STABLES_API_KEY: "sti_test_x" }, true);
    expect(withTestKey.ok).toBe(false);
    expect(withTestKey.problems.join(" ")).toMatch(/TEST key/);
    const withSandbox = evaluateMode(
      { ...LIVE_ENV, STABLES_API_URL: "https://api.sandbox.stables.money" },
      true,
    );
    expect(withSandbox.ok).toBe(false);
  });

  it("is blocked by a devnet RPC or the dev database", () => {
    expect(
      evaluateMode({ ...LIVE_ENV, SOLANA_RPC_URL: "https://api.devnet.solana.com" }, true).ok,
    ).toBe(false);
    expect(
      evaluateMode({ ...LIVE_ENV, SUPABASE_URL: "https://gdksfksypkcfiohozzsx.supabase.co" }, true)
        .ok,
    ).toBe(false);
  });

  it("refuses test endpoints and test keys at call time", async () => {
    expect(endpointAllowed("live", "stables", "https://api.sandbox.stables.money").ok).toBe(false);
    expect(endpointAllowed("live", "solana_rpc", "https://api.devnet.solana.com").ok).toBe(false);
    useEnv({
      LAMPORTPAY_MODE: "live",
      STABLES_API_KEY: "sti_test_x",
      STABLES_API_URL: "https://api.stables.money",
    });
    expect(getStablesConfig()).toMatchObject({ configured: false });
    const res = await rpc("devnet", "getBalance", [WALLET]);
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses mainnet coins only (no devnet test USDC)", async () => {
    const { MODE_PROFILES, DEVNET_USDC_MINT } = await import("@/lib/app-mode");
    expect(MODE_PROFILES.live.mints.usdc).toBe(USDC_MINT);
    expect(Object.values(MODE_PROFILES.live.mints)).not.toContain(DEVNET_USDC_MINT);
    expect(MODE_PROFILES.test.mints.usdc).toBe(DEVNET_USDC_MINT);
  });
});

// ---------------------------------------------------------------- 3

const status = (over: Partial<ModeStatus>): ModeStatus => ({
  mode: "test",
  ok: true,
  problems: [],
  solanaCluster: "devnet",
  stablesEnvironment: "sandbox",
  realFunds: false,
  liveAvailable: false,
  liveBlockers: [],
  liveUrl: null,
  ...over,
});

describe("3. The mode indicator reflects the server's environment", () => {
  it("shows what the server reports", async () => {
    useEnv(TEST_ENV);
    const res = await handler(
      StatusRoute,
      "GET",
    )({ request: new Request("http://x/api/integration-status") });
    const body = (await res.json()) as { mode: ModeStatus };
    expect(body.mode).toMatchObject({
      mode: "test",
      ok: true,
      solanaCluster: "devnet",
      realFunds: false,
    });
    expect(modeIndicator(body.mode, "test")).toMatchObject({
      tone: "test",
      label: "TEST MODE",
      blocking: false,
    });
  });

  it("reports a blocked server as blocked, whatever the page thinks", async () => {
    useEnv({ ...LIVE_ENV }); // LIVE requested, but the code lock is closed
    const res = await handler(
      StatusRoute,
      "GET",
    )({ request: new Request("http://x/api/integration-status") });
    const body = (await res.json()) as { mode: ModeStatus };
    expect(body.mode).toMatchObject({ mode: "live", ok: false });
    // No configuration details leak to the public status.
    expect(body.mode.liveBlockers.join(" ")).not.toMatch(/SOLANA_RPC_URL|SUPABASE/);
    expect(modeIndicator(body.mode, "live")).toMatchObject({ tone: "error", blocking: true });
  });

  it("flags a page built for another mode", () => {
    expect(modeIndicator(status({ mode: "test" }), "live")).toMatchObject({
      tone: "error",
      label: "MODE MISMATCH",
      blocking: true,
    });
    expect(modeIndicator(null, "test")).toMatchObject({ tone: "loading", blocking: true });
    expect(
      modeIndicator(status({ mode: "live", ok: true, realFunds: true }), "live"),
    ).toMatchObject({ tone: "live", label: "LIVE MODE" });
  });

  it("records the observed mode in the audit log", async () => {
    useEnv(TEST_ENV);
    await handler(StatusRoute, "GET")({ request: new Request("http://x/api/integration-status") });
    await new Promise((r) => setTimeout(r, 0));
    expect(
      db
        .table("app_mode_events")
        .some((e) => e["event"] === "mode_observed" && e["mode"] === "test"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------- 4

describe("4. Switching modes cannot bypass server-side protection", () => {
  it("a switch request never changes the server's mode and is audited", async () => {
    useEnv(TEST_ENV);
    const res = await handler(
      SwitchRoute,
      "POST",
    )({
      request: new Request("http://x/api/mode/switch-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-lamportpay-mode": "live" },
        body: JSON.stringify({ to: "live" }),
      }),
    });
    const body = (await res.json()) as {
      allowed: boolean;
      url: string | null;
      modeChanged: boolean;
    };
    expect(body).toMatchObject({ allowed: false, url: null, modeChanged: false });
    expect(currentMode().mode).toBe("test");
    expect(() => requireRealFundsMode()).toThrow(
      expect.objectContaining({ code: "test_mode_no_real_funds" }),
    );
    const audit = db.table("app_mode_events").find((e) => e["event"] === "switch_requested");
    expect(audit).toMatchObject({
      mode: "test",
      ok: false,
      detail: expect.objectContaining({ to: "live", allowed: false }),
    });
  });

  it("rejects anything but test or live", async () => {
    const res = await handler(
      SwitchRoute,
      "POST",
    )({
      request: new Request("http://x/api/mode/switch-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "live", force: true }),
      }),
    });
    expect(res.status).toBe(400);
  });

  it("the endpoint guard reads only the server mode, never the caller", () => {
    useEnv(TEST_ENV);
    expect(() =>
      assertEndpointAllowed("jupiter_execute", "https://api.jup.ag/swap/v2/execute"),
    ).toThrow(ModeGuardError);
  });
});

// ---------------------------------------------------------------- 5

describe("5. LIVE MODE stays disabled until configured AND approved", () => {
  it("ships with the code lock closed", () => {
    expect(LIVE_MODE_CODE_UNLOCKED).toBe(false);
  });

  it("a complete production configuration alone does not enable it", () => {
    useEnv({ ...LIVE_ENV });
    const s = currentMode();
    expect(s).toMatchObject({ mode: "live", ok: false, liveAvailable: false, liveUrl: null });
    expect(() => requireModeProfile()).toThrow(
      expect.objectContaining({ status: 503, code: "mode_blocked" }),
    );
  });

  it("needs the recorded owner approval even with the lock open", () => {
    const { LAMPORTPAY_LIVE_APPROVED_BY: _by, ...noApproval } = LIVE_ENV;
    const s = evaluateMode(noApproval, true);
    expect(s.ok).toBe(false);
    expect(s.problems.join(" ")).toMatch(/approval/);
  });

  it("is available only with lock open + approval + full production config", () => {
    expect(evaluateMode({ ...LIVE_ENV }, true)).toMatchObject({
      mode: "live",
      ok: true,
      realFunds: true,
      liveAvailable: true,
    });
  });

  it("blocks payment API calls with 503 when LIVE is requested but not enabled", async () => {
    useEnv({ ...LIVE_ENV });
    const { handleUserRequest } = await import("@/lib/payments/http.server");
    const res = await handleUserRequest(new Request("http://x"), undefined, async () =>
      Response.json({ reached: true }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "mode_blocked" });
  });
});
