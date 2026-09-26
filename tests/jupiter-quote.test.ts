import { describe, expect, it } from "vitest";

import {
  api,
  assertNoSecretLeak,
  getIntegrationStatus,
  MAX_LAMPORTS,
  MIN_LAMPORTS,
  providerMode,
  SOL_MINT,
  USDC_MINT,
} from "./helpers";

type QuotePreview = {
  source: "sandbox" | "mock";
  demoMode: boolean;
  message: string;
  inputMint: string;
  outputMint: string;
  inAmountSol: number;
  outAmountUsdc: number;
  minOutAmountUsdc: number;
  slippageBps: number;
  steps: Array<{ amm: string; percent: number }>;
};

const quote = (body: unknown) =>
  api<QuotePreview & { error?: string }>("/api/jupiter/quote", { method: "POST", body });

describe("POST /api/jupiter/quote — read-only route preview", () => {
  it("returns a coherent preview at the minimum amount", async () => {
    const status = await getIntegrationStatus();
    const res = await quote({ inputMint: SOL_MINT, outputMint: USDC_MINT, amount: MIN_LAMPORTS });

    expect(res.status).toBe(200);
    assertNoSecretLeak(res.raw);

    const p = res.body;
    // Sandbox when the Jupiter key is configured, mock fallback otherwise.
    expect(p.source).toBe(providerMode(status, "Jupiter") === "sandbox" ? "sandbox" : "mock");
    expect(p.demoMode).toBe(p.source === "mock");
    expect(p.inputMint).toBe(SOL_MINT);
    expect(p.outputMint).toBe(USDC_MINT);
    expect(p.inAmountSol).toBeCloseTo(0.001, 9);
    expect(p.outAmountUsdc).toBeGreaterThan(0);
    // Guard against the old bug where slippage 0 made min == expected output.
    expect(p.slippageBps).toBeGreaterThan(0);
    expect(p.minOutAmountUsdc).toBeGreaterThan(0);
    expect(p.minOutAmountUsdc).toBeLessThan(p.outAmountUsdc);
    expect(p.steps.length).toBeGreaterThan(0);
    expect(typeof p.message).toBe("string");
  });

  it("accepts the maximum allowed amount", async () => {
    const res = await quote({ amount: MAX_LAMPORTS });
    expect(res.status).toBe(200);
    expect(res.body.outAmountUsdc).toBeGreaterThan(0);
  });

  it("scales output roughly linearly with input", async () => {
    const small = await quote({ amount: MIN_LAMPORTS });
    const big = await quote({ amount: "5000000" });
    expect(big.body.outAmountUsdc).toBeGreaterThan(small.body.outAmountUsdc);
  });

  it("enforces the 0.001 SOL minimum", async () => {
    const res = await quote({ amount: "999999" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/0\.001 SOL/);
  });

  it("enforces the 0.01 SOL maximum", async () => {
    const res = await quote({ amount: "10000001" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/0\.01 SOL/);
  });

  it("locks the input mint to SOL", async () => {
    const res = await quote({ inputMint: USDC_MINT, amount: MIN_LAMPORTS });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inputMint/);
  });

  it("locks the output mint to USDC", async () => {
    const res = await quote({ outputMint: SOL_MINT, amount: MIN_LAMPORTS });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outputMint/);
  });

  it("rejects unknown fields such as destination overrides", async () => {
    const res = await quote({ amount: MIN_LAMPORTS, receiver: "someone-else" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric amount", async () => {
    const res = await quote({ amount: "0.001" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lamports|numeric/i);
  });

  it("rejects malformed JSON", async () => {
    const res = await api<{ error?: string }>("/api/jupiter/quote", {
      method: "POST",
      body: "{not-json",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON/i);
  });
});
