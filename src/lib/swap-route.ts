/**
 * Shared swap-route preview types and mock routing.
 *
 * Client-safe: contains no secrets and no server-only imports.
 * Real routing data comes from POST /api/jupiter/quote, which falls back
 * to this mock routing when JUPITER_API_KEY is not configured.
 */

import { SOL_MINT, USDC_MINT } from "@/lib/tokens";

export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;

/** Display-only reference price used for mock routing. */
export const MOCK_SOL_USD = 165;

export type RouteStepPreview = {
  label: string;
  amm: string;
  inputSymbol: string;
  outputSymbol: string;
  percent: number;
  feeUsd: number | null;
};

export type SwapRoutePreview = {
  /** "sandbox" = live Jupiter routing data, "mock" = local fallback routing. */
  source: "sandbox" | "mock";
  demoMode: boolean;
  message: string;
  inputMint: string;
  outputMint: string;
  inAmountLamports: string;
  inAmountSol: number;
  outAmountUsdc: number;
  minOutAmountUsdc: number;
  slippageBps: number;
  priceImpactPct: number | null;
  networkFeeSol: number;
  platformFeeUsd: number;
  lpFeeUsd: number;
  steps: RouteStepPreview[];
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

/** Deterministic local routing used when Jupiter keys are absent. */
export function buildMockRoutePreview(
  lamports: string,
  message = "Jupiter API key not configured — showing mock routing.",
): SwapRoutePreview {
  const inAmountSol = lamportsToSol(lamports);
  const grossUsdc = inAmountSol * MOCK_SOL_USD;
  const lpFeeUsd = grossUsdc * 0.0005;
  const outAmountUsdc = Math.max(grossUsdc - lpFeeUsd, 0);
  const slippageBps = 50;

  return {
    source: "mock",
    demoMode: true,
    message,
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    inAmountLamports: lamports,
    inAmountSol,
    outAmountUsdc,
    minOutAmountUsdc: outAmountUsdc * (1 - slippageBps / 10_000),
    slippageBps,
    priceImpactPct: 0.01,
    networkFeeSol: 0.000005,
    platformFeeUsd: 0,
    lpFeeUsd,
    steps: [
      {
        label: "SOL → USDC",
        amm: "Orca Whirlpool (mock)",
        inputSymbol: "SOL",
        outputSymbol: "USDC",
        percent: 60,
        feeUsd: lpFeeUsd * 0.6,
      },
      {
        label: "SOL → USDC",
        amm: "Raydium CLMM (mock)",
        inputSymbol: "SOL",
        outputSymbol: "USDC",
        percent: 40,
        feeUsd: lpFeeUsd * 0.4,
      },
    ],
  };
}
