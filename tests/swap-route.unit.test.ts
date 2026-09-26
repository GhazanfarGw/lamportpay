import { describe, expect, it } from "vitest";

import {
  buildMockRoutePreview,
  lamportsToSol,
  solToLamports,
  baseUnitsToUsdc,
} from "@/lib/swap-route";
import { SOL_MINT, USDC_MINT, isSupportedInputMint } from "@/lib/tokens";

describe("swap-route mock fallback", () => {
  it("converts units correctly", () => {
    expect(lamportsToSol("1000000")).toBeCloseTo(0.001, 9);
    expect(solToLamports(0.001)).toBe("1000000");
    expect(baseUnitsToUsdc("1000000")).toBe(1);
  });

  it("builds a coherent mock preview flagged as demo mode", () => {
    const p = buildMockRoutePreview("1000000");
    expect(p.source).toBe("mock");
    expect(p.demoMode).toBe(true);
    expect(p.inputMint).toBe(SOL_MINT);
    expect(p.outputMint).toBe(USDC_MINT);
    expect(p.outAmountUsdc).toBeGreaterThan(0);
    expect(p.minOutAmountUsdc).toBeLessThan(p.outAmountUsdc);
    expect(p.slippageBps).toBeGreaterThan(0);
    expect(p.steps.reduce((s, step) => s + step.percent, 0)).toBe(100);
  });

  it("keeps token guards locked to SOL input", () => {
    expect(isSupportedInputMint(SOL_MINT)).toBe(true);
    expect(isSupportedInputMint(USDC_MINT)).toBe(false);
  });
});
