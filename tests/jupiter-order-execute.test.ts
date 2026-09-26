import { describe, expect, it } from "vitest";

import {
  api,
  assertNoSecretLeak,
  getIntegrationStatus,
  MAX_LAMPORTS,
  MIN_LAMPORTS,
  providerMode,
  SOL_MINT,
  TEST_TAKER,
  USDC_MINT,
} from "./helpers";

type OrderResponse = {
  transaction?: string | null;
  requestId?: string | null;
  outAmount?: string | null;
  error?: string;
};

const order = (body: unknown) => api<OrderResponse>("/api/jupiter/order", { method: "POST", body });

const validOrder = {
  inputMint: SOL_MINT,
  outputMint: USDC_MINT,
  amount: MIN_LAMPORTS,
  taker: TEST_TAKER,
};

describe("POST /api/jupiter/order — guards", () => {
  it("rejects every destination-override field", async () => {
    const forbidden = [
      "receiver",
      "destinationTokenAccount",
      "payer",
      "referralAccount",
      "referralTokenAccount",
      "feeAccount",
      "platformFeeBps",
      "recipient",
      "merchantWallet",
      "payoutWallet",
    ];
    for (const field of forbidden) {
      const res = await order({ ...validOrder, [field]: "x" });
      expect(res.status, `field ${field} must be blocked`).toBe(400);
      expect(res.body.error).toMatch(/Destination override is not allowed/);
    }
  });

  it("rejects an invalid taker address", async () => {
    const res = await order({ ...validOrder, taker: "not-a-wallet!" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/taker/);
  });

  it("requires a taker", async () => {
    const { taker: _taker, ...rest } = validOrder;
    const res = await order(rest);
    expect(res.status).toBe(400);
  });

  it("enforces the SOL amount limits", async () => {
    const below = await order({ ...validOrder, amount: "999999" });
    expect(below.status).toBe(400);
    expect(below.body.error).toMatch(/0\.001 SOL/);

    const above = await order({ ...validOrder, amount: "10000001" });
    expect(above.status).toBe(400);
    expect(above.body.error).toMatch(/0\.01 SOL/);

    const atMax = await order({ ...validOrder, amount: MAX_LAMPORTS });
    expect(atMax.status).not.toBe(400);
  });

  it("locks the mints to SOL → USDC", async () => {
    const badIn = await order({ ...validOrder, inputMint: USDC_MINT });
    expect(badIn.status).toBe(400);
    const badOut = await order({ ...validOrder, outputMint: SOL_MINT });
    expect(badOut.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const res = await api<OrderResponse>("/api/jupiter/order", {
      method: "POST",
      body: "{oops",
    });
    expect(res.status).toBe(400);
  });

  it("returns an unsigned transaction when the sandbox key is configured", async () => {
    const status = await getIntegrationStatus();
    const res = await order(validOrder);
    assertNoSecretLeak(res.raw);

    if (providerMode(status, "Jupiter") !== "sandbox") {
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/Missing Jupiter API key/);
      return;
    }

    // 502 is acceptable: upstream routing can be temporarily unavailable.
    expect([200, 502]).toContain(res.status);
    if (res.status === 200) {
      expect(typeof res.body.transaction).toBe("string");
      expect(res.body.requestId).toBeTruthy();
      // The order is never signed or executed by this suite.
      expect(res.body.transaction).not.toContain("privateKey");
    }
  });
});

describe("POST /api/jupiter/execute — guards (never executes a real swap)", () => {
  const base = { signedTransaction: "AQAB", requestId: "test-request-id" };

  it("rejects private key and seed phrase fields", async () => {
    const forbidden = [
      "privateKey",
      "private_key",
      "secretKey",
      "secret_key",
      "seedPhrase",
      "seed_phrase",
      "mnemonic",
    ];
    for (const field of forbidden) {
      const res = await api<{ error?: string }>("/api/jupiter/execute", {
        method: "POST",
        body: { ...base, [field]: "leak me" },
      });
      expect(res.status, `field ${field} must be blocked`).toBe(400);
      expect(res.body.error).toMatch(/Private key or seed phrase/);
    }
  });

  it("rejects a non-base64 signed transaction", async () => {
    const res = await api<{ error?: string }>("/api/jupiter/execute", {
      method: "POST",
      body: { ...base, signedTransaction: "not base64 !!" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/base64/);
  });

  it("requires requestId", async () => {
    const res = await api<{ error?: string }>("/api/jupiter/execute", {
      method: "POST",
      body: { signedTransaction: "AQAB" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requestId|Required/i);
  });

  it("rejects unknown extra fields", async () => {
    const res = await api<{ error?: string }>("/api/jupiter/execute", {
      method: "POST",
      body: { ...base, sneaky: true },
    });
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const res = await api<{ error?: string }>("/api/jupiter/execute", {
      method: "POST",
      body: "{",
    });
    expect(res.status).toBe(400);
  });
});
