import { describe, expect, it } from "vitest";

import {
  baseUnitsToUsdc,
  buildRoutePreview,
  hasRoute,
  lamportsToSol,
  readJupiterError,
  solToLamports,
  type JupiterOrderPayload,
} from "@/lib/swap-route";
import { SOL_MINT, USDC_MINT, isSupportedInputMint } from "@/lib/tokens";

/** Shape of a read-only swap/v2/order answer (no taker), from the 2026-09-28 probe. */
const ORDER: JupiterOrderPayload = {
  inAmount: "816000000",
  outAmount: "99920415",
  otherAmountThreshold: "99920415",
  slippageBps: 0,
  priceImpactPct: "-0.00021240215570747018",
  routePlan: [
    { percent: 25, swapInfo: { label: "BisonFi", inputMint: SOL_MINT, outputMint: USDC_MINT } },
    { percent: 75, swapInfo: { label: "AlphaQ", inputMint: SOL_MINT, outputMint: USDC_MINT } },
  ],
  feeBps: 2,
  feeMint: SOL_MINT,
  signatureFeeLamports: 0,
  prioritizationFeeLamports: 0,
  rentFeeLamports: 0,
  inUsdValue: 99.92784019799318,
  outUsdValue: 99.90661530931993,
};

describe("swap-route helpers", () => {
  it("converts units", () => {
    expect(lamportsToSol("1000000")).toBeCloseTo(0.001, 9);
    expect(solToLamports(0.001)).toBe("1000000");
    expect(baseUnitsToUsdc("1000000")).toBe(1);
  });

  it("builds the preview only from Jupiter's numbers", () => {
    const p = buildRoutePreview("816000000", SOL_MINT, USDC_MINT, ORDER);
    expect(p.inAmountSol).toBeCloseTo(0.816, 9);
    expect(p.outAmountUsdc).toBeCloseTo(99.920415, 6);
    expect(p.minOutAmountUsdc).toBeCloseTo(99.920415, 6);
    expect(p.slippageBps).toBe(0);
    // Jupiter's fraction, shown as percent.
    expect(p.priceImpactPct).toBeCloseTo(-0.0212402155707, 10);
    expect(p.inUsdValue).toBeCloseTo(99.92784, 5);
    // 2 bps of the input's USD value, as Jupiter priced it.
    expect(p.swapFeeUsd).toBeCloseTo((99.92784019799318 * 2) / 10_000, 9);
    // No taker yet: Jupiter reports zero network fees.
    expect(p.networkFeeLamports).toBeNull();
    expect(p.steps.map((s) => [s.amm, s.percent])).toEqual([
      ["BisonFi", 25],
      ["AlphaQ", 75],
    ]);
    expect(p.message).not.toMatch(/mock/i);
  });

  it("leaves unknown values null instead of inventing them", () => {
    const p = buildRoutePreview("1000000", SOL_MINT, USDC_MINT, { outAmount: "122640" });
    expect(p.minOutAmountUsdc).toBeNull();
    expect(p.slippageBps).toBeNull();
    expect(p.priceImpactPct).toBeNull();
    expect(p.inUsdValue).toBeNull();
    expect(p.swapFeeUsd).toBeNull();
    expect(p.steps).toEqual([]);
  });

  it("treats Jupiter's HTTP-200 error answers as errors", () => {
    const refused = {
      errorCode: 1,
      errorMessage: "Insufficient funds",
      error: "Insufficient funds",
    };
    expect(readJupiterError(refused)).toBe("Insufficient funds");
    expect(readJupiterError({ errorCode: 7 })).toBe("Jupiter error (code 7).");
    expect(readJupiterError(null)).toBe("Invalid response from Jupiter.");
    expect(readJupiterError(ORDER)).toBeNull();
    expect(hasRoute(refused)).toBe(false);
    expect(hasRoute({ outAmount: "1.5" })).toBe(false);
    expect(hasRoute(ORDER)).toBe(true);
  });

  it("keeps token guards locked to SOL input", () => {
    expect(isSupportedInputMint(SOL_MINT)).toBe(true);
    expect(isSupportedInputMint(USDC_MINT)).toBe(false);
  });
});
