/**
 * Server-side TEST / LIVE mode: configuration, validation and endpoint guards.
 *
 * - The mode comes only from the server environment (LAMPORTPAY_MODE; default
 *   "test"). Nothing the browser sends can change it.
 * - Each mode must use its own configuration. A mismatch BLOCKS payments
 *   (503 mode_blocked); the server never silently falls back to the other mode.
 * - LIVE MODE needs three things: the code lock opened (app-mode-lock.ts), an
 *   owner approval recorded in the environment, and a complete production
 *   configuration. Until then it is unavailable.
 * - Endpoint guard: in TEST MODE no production payment endpoint is ever called
 *   (Stables production, Solana mainnet RPC, Jupiter swap orders/execution).
 *   Jupiter is mainnet-only: TEST MODE may read its price quotes (no wallet, no
 *   transaction) but can never build or send a swap.
 *   In LIVE MODE no test endpoint or test credential is used.
 */
import { LIVE_MODE_CODE_UNLOCKED } from "./app-mode-lock";
import { MODE_PROFILES, type AppMode, type ModeProfile, type ModeStatus } from "./app-mode";
import { PaymentError } from "./payments/errors";
import { DEFAULT_RPC_URLS } from "./solana-rpc";

type Env = Record<string, string | undefined>;

export const STABLES_SANDBOX_HOST_MARK = "sandbox";
/** Supabase project refs (not secrets): dev/test and live. */
export const DEV_SUPABASE_REF = "gdksfksypkcfiohozzsx";
export const LIVE_SUPABASE_REF = "zmcbnknjatrfwrcfvtzt";

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The requested mode, or an error for an unknown value (never guessed). */
export function requestedMode(env: Env = process.env): { mode: AppMode; invalid: string | null } {
  const raw = env["LAMPORTPAY_MODE"]?.trim().toLowerCase();
  if (!raw || raw === "test") return { mode: "test", invalid: null };
  if (raw === "live") return { mode: "live", invalid: null };
  // Unknown values block payments in TEST MODE rather than guessing.
  return {
    mode: "test",
    invalid: `LAMPORTPAY_MODE must be "test" or "live", not ${JSON.stringify(raw)}.`,
  };
}

function stablesUrl(env: Env): string {
  return env["STABLES_API_URL"]?.trim() || "https://api.sandbox.stables.money";
}

function isSandboxStables(env: Env): boolean {
  return (hostOf(stablesUrl(env)) ?? "").includes(STABLES_SANDBOX_HOST_MARK);
}

function testRpcUrl(env: Env): string {
  return env["SOLANA_DEVNET_RPC_URL"]?.trim() || DEFAULT_RPC_URLS.devnet;
}

function looksMainnet(url: string | undefined): boolean {
  const host = hostOf(url) ?? "";
  return host.includes("mainnet");
}

function looksTestCluster(url: string | undefined): boolean {
  const host = hostOf(url) ?? "";
  return host.includes("devnet") || host.includes("testnet");
}

/** Problems that stop TEST MODE (test must only touch test systems). */
function testProblems(env: Env): string[] {
  const problems: string[] = [];
  if (!isSandboxStables(env)) {
    problems.push("TEST MODE must use the Stables sandbox API, not production.");
  }
  if (env["STABLES_API_KEY"]?.trim().startsWith("sti_live_")) {
    problems.push("TEST MODE must not hold a live Stables key.");
  }
  if (looksMainnet(testRpcUrl(env))) {
    problems.push("TEST MODE's Solana RPC (SOLANA_DEVNET_RPC_URL) points at mainnet.");
  }
  if ((env["SUPABASE_URL"] ?? "").includes(LIVE_SUPABASE_REF)) {
    problems.push("TEST MODE must not use the live database.");
  }
  return problems;
}

/** Everything LIVE MODE needs; empty = live could run. */
function liveBlockers(env: Env, codeUnlocked: boolean): string[] {
  const blockers: string[] = [];
  if (!codeUnlocked) {
    blockers.push("Live mode is locked in the code until the owner approves going live.");
  }
  const approvedBy = env["LAMPORTPAY_LIVE_APPROVED_BY"]?.trim();
  const approvedAt = env["LAMPORTPAY_LIVE_APPROVED_AT"]?.trim();
  if (!approvedBy || !approvedAt || Number.isNaN(Date.parse(approvedAt))) {
    blockers.push("No owner approval is recorded (LAMPORTPAY_LIVE_APPROVED_BY / _AT).");
  }
  if (isSandboxStables(env)) blockers.push("The production Stables API is not configured.");
  const key = env["STABLES_API_KEY"]?.trim();
  if (!key) blockers.push("No Stables API key is set.");
  else if (key.startsWith("sti_test_"))
    blockers.push("A Stables TEST key cannot be used in live mode.");
  const mainnetRpc = env["SOLANA_RPC_URL"]?.trim();
  if (!mainnetRpc) blockers.push("A dedicated Solana mainnet RPC (SOLANA_RPC_URL) is not set.");
  else if (looksTestCluster(mainnetRpc)) blockers.push("SOLANA_RPC_URL points at a test cluster.");
  const supabase = env["SUPABASE_URL"] ?? "";
  if (!supabase || supabase.includes(DEV_SUPABASE_REF)) {
    blockers.push("Live mode must use the production database, not the dev project.");
  }
  if (!hostOf(env["LAMPORTPAY_LIVE_URL"]))
    blockers.push("No live app URL (LAMPORTPAY_LIVE_URL) is set.");
  return blockers;
}

/** Full, secret-free mode report. `codeUnlocked` is injectable for tests only via the lock module. */
export function evaluateMode(
  env: Env = process.env,
  codeUnlocked: boolean = LIVE_MODE_CODE_UNLOCKED,
): ModeStatus {
  const { mode, invalid } = requestedMode(env);
  const profile = MODE_PROFILES[mode];
  const live = liveBlockers(env, codeUnlocked);
  const problems = invalid ? [invalid] : mode === "test" ? testProblems(env) : live;
  const liveUrl = env["LAMPORTPAY_LIVE_URL"]?.trim() || null;
  return {
    mode,
    ok: problems.length === 0,
    problems,
    solanaCluster: profile.solanaCluster,
    stablesEnvironment: profile.stablesEnvironment,
    realFunds: profile.realFunds,
    liveAvailable: live.length === 0,
    liveBlockers: live,
    liveUrl: live.length === 0 ? liveUrl : null,
  };
}

/**
 * What anyone may see: the mode and whether it is usable. Configuration
 * details (which variable is missing) are for admins only.
 */
export function publicModeStatus(status: ModeStatus): ModeStatus {
  return {
    ...status,
    problems: status.ok ? [] : ["The server configuration does not match its mode."],
    liveBlockers: status.liveAvailable
      ? []
      : ["Production setup and owner approval are not complete."],
  };
}

export function currentMode(): ModeStatus {
  return evaluateMode(process.env);
}

/** The active profile, or a 503 when the configuration does not match the mode. */
export function requireModeProfile(status: ModeStatus = currentMode()): ModeProfile {
  if (!status.ok) {
    console.error("[mode] blocked:", status.mode, status.problems.join(" | "));
    throw new PaymentError(
      `${status.mode === "live" ? "LIVE" : "TEST"} MODE is blocked by its configuration. No payment actions are possible.`,
      503,
      "mode_blocked",
    );
  }
  return MODE_PROFILES[status.mode];
}

/** Refuse anything that could move real funds unless LIVE MODE is fully active. */
export function requireRealFundsMode(status: ModeStatus = currentMode()): void {
  const profile = requireModeProfile(status);
  if (!profile.realFunds) {
    throw new PaymentError(
      "TEST MODE: moving real funds is impossible here. Use test assets; the sandbox deposit is simulated by an admin.",
      409,
      "test_mode_no_real_funds",
    );
  }
}

export type EndpointKind =
  "stables" | "solana_rpc" | "jupiter_quote" | "jupiter_order" | "jupiter_execute";

export class ModeGuardError extends Error {
  constructor(
    message: string,
    readonly kind: EndpointKind,
  ) {
    super(message);
    this.name = "ModeGuardError";
  }
}

/**
 * Whether calling `url` for `kind` is allowed in `mode`. TEST MODE never calls
 * a production payment endpoint; LIVE MODE never calls a test one.
 */
export function endpointAllowed(
  mode: AppMode,
  kind: EndpointKind,
  url: string,
  opts: { withWallet?: boolean } = {},
): { ok: true } | { ok: false; reason: string } {
  const host = hostOf(url) ?? "";
  if (kind === "stables") {
    const sandbox = host.includes(STABLES_SANDBOX_HOST_MARK);
    if (mode === "test" && !sandbox)
      return { ok: false, reason: "TEST MODE: the production Stables API is blocked." };
    if (mode === "live" && sandbox)
      return { ok: false, reason: "LIVE MODE: the Stables sandbox is blocked." };
    return { ok: true };
  }
  if (kind === "solana_rpc") {
    if (mode === "test" && looksMainnet(url))
      return { ok: false, reason: "TEST MODE: Solana mainnet RPC is blocked." };
    if (mode === "live" && looksTestCluster(url))
      return { ok: false, reason: "LIVE MODE: Solana test clusters are blocked." };
    return { ok: true };
  }
  if (isJupiterKind(kind)) {
    // Jupiter has no devnet: every Jupiter call is a mainnet call. TEST MODE
    // allows only the read-only price quote (no wallet, no transaction: nothing
    // can be signed or moved) so swap pricing, fees and price impact can be
    // tested (owner decision, 3 Oct 2026). Building an order for a wallet (a
    // real mainnet transaction) and relaying one stay blocked in TEST MODE.
    const readOnly = kind === "jupiter_quote" || (kind === "jupiter_order" && !opts.withWallet);
    if (mode === "test" && !readOnly)
      return {
        ok: false,
        reason:
          "TEST MODE: Jupiter swap transactions run on Solana mainnet only, so building or sending one is blocked. Price quotes are read-only and allowed.",
      };
  }
  return { ok: true };
}

function isJupiterKind(kind: EndpointKind): boolean {
  return kind === "jupiter_quote" || kind === "jupiter_order" || kind === "jupiter_execute";
}

/** Throws ModeGuardError when the current mode forbids calling `url`. */
export function assertEndpointAllowed(
  kind: EndpointKind,
  url: string,
  opts: { withWallet?: boolean } = {},
  status: ModeStatus = currentMode(),
): void {
  let verdict = endpointAllowed(status.mode, kind, url, opts);
  // A mode whose configuration fails its checks (e.g. LIVE requested but not
  // approved) never reaches Jupiter, not even for a quote.
  if (verdict.ok && isJupiterKind(kind) && !status.ok) {
    verdict = {
      ok: false,
      reason: `${status.mode.toUpperCase()} MODE is blocked by its configuration: Jupiter is not called.`,
    };
  }
  if (!verdict.ok) {
    console.error("[mode] endpoint refused:", kind, hostOf(url), verdict.reason);
    throw new ModeGuardError(verdict.reason, kind);
  }
}
