/**
 * Swap-route preview types and pure helpers, shared by POST /api/jupiter/quote
 * and the route preview card.
 *
 * Client-safe: no secrets and no server-only imports. Every number in a
 * preview comes from Jupiter's own response. There is no mock or fallback
 * routing and no hard-coded token price: when Jupiter omits a value, the
 * preview carries null and the UI says so.
 */

import { getTokenInfo } from "@/lib/tokens";

export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;

export type RouteStepPreview = {
  label: string;
  amm: string;
  inputSymbol: string;
  outputSymbol: string;
  percent: number;
  /** Priced with Jupiter's own USD values; null when Jupiter gives none. */
  feeUsd: number | null;
};

export type SwapRoutePreview = {
  message: string;
  inputMint: string;
  outputMint: string;
  inAmountLamports: string;
  inAmountSol: number;
  outAmountUsdc: number;
  /** Jupiter's otherAmountThreshold (minimum output for ExactIn); null when absent. */
  minOutAmountUsdc: number | null;
  /** As Jupiter reports it. A preview without a taker reports 0: the order sets it. */
  slippageBps: number | null;
  priceImpactPct: number | null;
  inUsdValue: number | null;
  outUsdValue: number | null;
  /** Jupiter's own swap fee, taken from the fee mint (the input mint for SOL pairs). */
  swapFeeBps: number | null;
  swapFeeUsd: number | null;
  /** Signature, priority and rent fees; null when Jupiter reports none (no taker yet). */
  networkFeeLamports: string | null;
  steps: RouteStepPreview[];
};

/** The parts of a Jupiter swap/v2/order response the preview reads. */
export type JupiterOrderPayload = {
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  slippageBps?: number;
  priceImpactPct?: string | number;
  routePlan?: Array<{
    percent?: number;
    swapInfo?: {
      ammKey?: string;
      label?: string;
      inputMint?: string;
      outputMint?: string;
      feeAmount?: string;
      feeMint?: string;
    };
  }>;
  feeBps?: number;
  feeMint?: string;
  platformFee?: { feeBps?: number; feeMint?: string };
  signatureFeeLamports?: number;
  prioritizationFeeLamports?: number;
  rentFeeLamports?: number;
  inUsdValue?: number | string;
  outUsdValue?: number | string;
  error?: unknown;
  errorCode?: unknown;
  errorMessage?: unknown;
};

export function lamportsToSol(lamports: string | number) {
  return Number(lamports) / 10 ** SOL_DECIMALS;
}

export function solToLamports(sol: number) {
  return Math.round(sol * 10 ** SOL_DECIMALS).toString();
}

export function baseUnitsToUsdc(units: string | number) {
  return Number(units) / 10 ** USDC_DECIMALS;
}

function finite(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const isBaseUnits = (value: unknown): value is string =>
  typeof value === "string" && /^\d+$/.test(value);

/**
 * Jupiter answers some failures with HTTP 200 and error / errorCode /
 * errorMessage instead of an order (for example errorCode 1, "Insufficient
 * funds"), so a 200 alone is not success. Returns Jupiter's message, or null.
 */
export function readJupiterError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "Invalid response from Jupiter.";
  }
  const { error, errorCode, errorMessage } = payload as Record<string, unknown>;
  const text = [errorMessage, error].find((v) => typeof v === "string" && v.trim() !== "");
  if (typeof text === "string") return text;
  if (errorCode !== undefined && errorCode !== null) return `Jupiter error (code ${errorCode}).`;
  if (error) return "Jupiter returned an error.";
  return null;
}

/** Whether a quote payload carries a usable route: no error field and a base-unit outAmount. */
export function hasRoute(payload: JupiterOrderPayload): boolean {
  return readJupiterError(payload) === null && isBaseUnits(payload.outAmount);
}

function symbolFor(mint?: string) {
  if (!mint) return "?";
  return getTokenInfo(mint)?.symbol ?? `${mint.slice(0, 4)}…`;
}

/**
 * Build the preview from a successful read-only order (no taker). USD figures
 * use Jupiter's inUsdValue / outUsdValue only, so a fee in the input or output
 * mint is priced at the rate Jupiter itself implies, and anything else is null.
 */
export function buildRoutePreview(
  amountLamports: string,
  inputMint: string,
  outputMint: string,
  payload: JupiterOrderPayload,
): SwapRoutePreview {
  const inAmountSol = lamportsToSol(amountLamports);
  const outAmountUsdc = baseUnitsToUsdc(payload.outAmount ?? "0");
  const inUsdValue = finite(payload.inUsdValue);
  const outUsdValue = finite(payload.outUsdValue);

  // USD per whole token, as implied by Jupiter's own numbers.
  const inUnitUsd = inUsdValue !== null && inAmountSol > 0 ? inUsdValue / inAmountSol : null;
  const outUnitUsd = outUsdValue !== null && outAmountUsdc > 0 ? outUsdValue / outAmountUsdc : null;
  const feeInUsd = (amount: number, mint?: string): number | null => {
    if (mint === inputMint && inUnitUsd !== null) return lamportsToSol(amount) * inUnitUsd;
    if (mint === outputMint && outUnitUsd !== null) return baseUnitsToUsdc(amount) * outUnitUsd;
    return null;
  };

  const steps: RouteStepPreview[] = (payload.routePlan ?? []).map((leg) => {
    const info = leg.swapInfo ?? {};
    const feeAmount = finite(info.feeAmount);
    return {
      label: `${symbolFor(info.inputMint)} → ${symbolFor(info.outputMint)}`,
      amm: info.label || info.ammKey?.slice(0, 8) || "Unknown AMM",
      inputSymbol: symbolFor(info.inputMint),
      outputSymbol: symbolFor(info.outputMint),
      percent: finite(leg.percent) ?? 100,
      feeUsd: feeAmount !== null ? feeInUsd(feeAmount, info.feeMint) : null,
    };
  });

  const swapFeeBps = finite(payload.feeBps) ?? finite(payload.platformFee?.feeBps);
  const swapFeeMint = payload.feeMint ?? payload.platformFee?.feeMint;
  const feeBase =
    swapFeeMint === inputMint ? inUsdValue : swapFeeMint === outputMint ? outUsdValue : null;
  const swapFeeUsd =
    swapFeeBps !== null && feeBase !== null ? (feeBase * swapFeeBps) / 10_000 : null;

  const networkFees = [
    payload.signatureFeeLamports,
    payload.prioritizationFeeLamports,
    payload.rentFeeLamports,
  ]
    .map(finite)
    .filter((n): n is number => n !== null);
  const networkFeeTotal = networkFees.reduce((sum, n) => sum + n, 0);

  const priceImpact = finite(payload.priceImpactPct);

  return {
    message: "Live Jupiter routing data (read-only preview — nothing is signed or sent).",
    inputMint,
    outputMint,
    inAmountLamports: amountLamports,
    inAmountSol,
    outAmountUsdc,
    minOutAmountUsdc: isBaseUnits(payload.otherAmountThreshold)
      ? baseUnitsToUsdc(payload.otherAmountThreshold)
      : null,
    slippageBps: finite(payload.slippageBps),
    // Jupiter reports the impact as a fraction; the preview shows percent.
    priceImpactPct: priceImpact !== null ? priceImpact * 100 : null,
    inUsdValue,
    outUsdValue,
    swapFeeBps,
    swapFeeUsd,
    networkFeeLamports: networkFeeTotal > 0 ? String(networkFeeTotal) : null,
    steps,
  };
}
