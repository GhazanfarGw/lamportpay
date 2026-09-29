import { describe, expect, it } from "vitest";

import {
  api,
  assertNoSecretLeak,
  E2E_TOKEN,
  FORGED_TOKEN,
  getIntegrationStatus,
  MAX_LAMPORTS,
  MIN_LAMPORTS,
  providerMode,
  SOL_MINT,
  USDC_MINT,
} from "./helpers";

type QuotePreview = {
  message: string;
  inputMint: string;
  outputMint: string;
  inAmountSol: number;
  outAmountUsdc: number;
  minOutAmountUsdc: number | null;
  slippageBps: number | null;
  steps: Array<{ amm: string; percent: number }>;
};

const quote = (body: unknown, token = E2E_TOKEN) =>
  api<QuotePreview & { error?: string }>("/api/jupiter/quote", { method: "POST", body, token });

const valid = { inputMint: SOL_MINT, outputMint: USDC_MINT, amount: MIN_LAMPORTS };

describe("POST /api/jupiter/quote — sign-in required", () => {
  it("refuses anonymous callers before reaching Jupiter", async () => {
    const res = await api<{ error?: string }>("/api/jupiter/quote", {
      method: "POST",
      body: valid,
    });
    expect(res.status).toBe(401);
    assertNoSecretLeak(res.raw);
  });

  it("refuses a forged token", async () => {
    const res = await quote(valid, FORGED_TOKEN);
    expect(res.status).toBe(401);
  });
});

// These need a real signed-in user of the dev project: set E2E_ACCESS_TOKEN.
describe.skipIf(!E2E_TOKEN)("POST /api/jupiter/quote — read-only route preview (signed in)", () => {
  it("returns a live preview, or an error, never mock numbers", async () => {
    const status = await getIntegrationStatus();
    const res = await quote(valid);
    assertNoSecretLeak(res.raw);

    if (providerMode(status, "Jupiter") !== "sandbox") {
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/not configured/);
      return;
    }
    // 502 is acceptable: Jupiter can be temporarily unable to route.
    expect([200, 502]).toContain(res.status);
    if (res.status !== 200) return;

    const p = res.body;
    expect(p.inputMint).toBe(SOL_MINT);
    expect(p.outputMint).toBe(USDC_MINT);
    expect(p.inAmountSol).toBeCloseTo(0.001, 9);
    expect(p.outAmountUsdc).toBeGreaterThan(0);
    expect(p).not.toHaveProperty("source");
    expect(p).not.toHaveProperty("demoMode");
    expect(p.message).not.toMatch(/mock/i);
  });

  it("accepts the maximum allowed amount", async () => {
    const res = await quote({ ...valid, amount: MAX_LAMPORTS });
    expect(res.status).not.toBe(400);
  });

  it("enforces the 0.001 SOL minimum", async () => {
    const res = await quote({ ...valid, amount: "999999" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/0\.001 SOL/);
  });

  it("enforces the 0.01 SOL maximum", async () => {
    const res = await quote({ ...valid, amount: "10000001" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/0\.01 SOL/);
  });

  it("locks the input mint to SOL", async () => {
    const res = await quote({ ...valid, inputMint: USDC_MINT });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inputMint/);
  });

  it("locks the output mint to USDC", async () => {
    const res = await quote({ ...valid, outputMint: SOL_MINT });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outputMint/);
  });

  it("rejects unknown fields such as destination overrides", async () => {
    const res = await quote({ ...valid, receiver: "someone-else" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric amount", async () => {
    const res = await quote({ ...valid, amount: "0.001" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lamports|numeric/i);
  });

  it("rejects malformed JSON", async () => {
    const res = await api<{ error?: string }>("/api/jupiter/quote", {
      method: "POST",
      body: "{not-json",
      token: E2E_TOKEN,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON/i);
  });
});
