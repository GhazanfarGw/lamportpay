/**
 * TEST MODE / LIVE MODE (shared by server and browser; no secrets here).
 *
 * The mode is a property of the SERVER deployment (LAMPORTPAY_MODE), never a
 * browser toggle: a test deployment and a live deployment are separate, with
 * separate environment configuration. The browser only displays what the
 * server reports and can ask to go to the live deployment; it cannot change
 * which endpoints the server calls. See app-mode.server.ts.
 */
import type { SolanaCluster } from "./solana-rpc";
import { USDC_MINT, USDT_MINT, type PaymentCurrency } from "./tokens";

export type AppMode = "test" | "live";

/**
 * Circle's USDC on Solana devnet (test asset from Circle's faucet,
 * faucet.circle.com). Not money. There is no official devnet USDT.
 */
export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export type ModeProfile = {
  mode: AppMode;
  label: "TEST MODE" | "LIVE MODE";
  /** Solana cluster for balances, transactions and explorer links. */
  solanaCluster: SolanaCluster;
  /** Stables environment this mode must talk to. */
  stablesEnvironment: "sandbox" | "production";
  /** Whether anything in this mode can move real funds. */
  realFunds: boolean;
  /** Payment coin mints in this mode; null = no such asset in this mode. */
  mints: Record<PaymentCurrency, string | null>;
  /**
   * Per-payment limits forced by this mode (major units, on what the user
   * sends), replacing the business settings while the mode is active; null =
   * the business settings decide. Never written to the settings table.
   */
  paymentLimits: Record<PaymentCurrency, { min: string; max: string | null } | null> | null;
};

/**
 * TEST MODE limits: 1–5,000 USDC sent per payment (owner decisions 3 Oct 2026:
 * max 10, raised to 5,000). Enforced on the server like the live limits; LIVE
 * limits are unchanged.
 */
export const TEST_MODE_LIMITS = { min: "1", max: "5000" } as const;

export const MODE_PROFILES: Record<AppMode, ModeProfile> = {
  test: {
    mode: "test",
    label: "TEST MODE",
    solanaCluster: "devnet",
    stablesEnvironment: "sandbox",
    realFunds: false,
    mints: { usdc: DEVNET_USDC_MINT, usdt: null },
    // USDT has no devnet asset (balance reads 0); it gets the same test limits so a
    // coin turned on in the business settings never makes TEST payments 503.
    paymentLimits: { usdc: { ...TEST_MODE_LIMITS }, usdt: { ...TEST_MODE_LIMITS } },
  },
  live: {
    mode: "live",
    label: "LIVE MODE",
    solanaCluster: "mainnet-beta",
    stablesEnvironment: "production",
    realFunds: true,
    mints: { usdc: USDC_MINT, usdt: USDT_MINT },
    paymentLimits: null,
  },
};

/** What the server reports about its mode (GET /api/integration-status → mode). */
export type ModeStatus = {
  mode: AppMode;
  /** False when the server's configuration does not match its mode; payments are then blocked. */
  ok: boolean;
  /** Why the current mode is blocked (safe to show; no secret values). */
  problems: string[];
  solanaCluster: SolanaCluster;
  stablesEnvironment: "sandbox" | "production";
  realFunds: boolean;
  /** Whether a LIVE deployment is configured, approved and reachable. */
  liveAvailable: boolean;
  /** Why LIVE MODE is not available yet. */
  liveBlockers: string[];
  /** URL of the separate live deployment, only when liveAvailable. */
  liveUrl: string | null;
};

/** Mode this browser bundle was built for (VITE_LAMPORTPAY_MODE); test unless set to "live". */
export function clientBuildMode(): AppMode {
  let raw: unknown;
  try {
    raw = import.meta.env?.["VITE_LAMPORTPAY_MODE"];
  } catch {
    raw = undefined;
  }
  return raw === "live" ? "live" : "test";
}

export type ModeIndicator = {
  tone: "test" | "live" | "error" | "loading";
  label: string;
  detail: string;
  /** True when payments/swaps must not be offered from this page. */
  blocking: boolean;
};

/**
 * The header indicator, derived ONLY from the server's report. A browser build
 * that disagrees with the server is shown as an error, never as either mode.
 */
export function modeIndicator(
  server: ModeStatus | null | undefined,
  build: AppMode,
): ModeIndicator {
  if (!server) {
    return {
      tone: "loading",
      label: "CHECKING MODE",
      detail: "Checking the server mode…",
      blocking: true,
    };
  }
  if (server.mode !== build) {
    return {
      tone: "error",
      label: "MODE MISMATCH",
      detail: `This page was built for ${build.toUpperCase()} MODE but the server runs ${server.mode.toUpperCase()} MODE. Payments are blocked.`,
      blocking: true,
    };
  }
  if (!server.ok) {
    return {
      tone: "error",
      label: `${server.mode.toUpperCase()} MODE · BLOCKED`,
      detail: server.problems.join(" ") || "The server configuration does not match its mode.",
      blocking: true,
    };
  }
  if (server.mode === "live") {
    return {
      tone: "live",
      label: "LIVE MODE",
      detail: "Real funds. Solana mainnet and the production payout partner.",
      blocking: false,
    };
  }
  return {
    tone: "test",
    label: "TEST MODE",
    detail: "No real funds can move. Solana devnet test assets and the payout partner's sandbox.",
    blocking: false,
  };
}

/** Explorer link for the mode's cluster. */
export function explorerTxUrl(signature: string, cluster: SolanaCluster): string {
  const q = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${q}`;
}
