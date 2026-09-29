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
  TEST_TAKER,
  USDC_MINT,
} from "./helpers";

type OrderResponse = {
  transaction?: string | null;
  requestId?: string | null;
  outAmount?: string | null;
  error?: string;
};

const order = (body: unknown, token = E2E_TOKEN) =>
  api<OrderResponse>("/api/jupiter/order", { method: "POST", body, token });
const execute = (body: unknown, token = E2E_TOKEN) =>
  api<{ error?: string }>("/api/jupiter/execute", { method: "POST", body, token });

const validOrder = {
  inputMint: SOL_MINT,
  outputMint: USDC_MINT,
  amount: MIN_LAMPORTS,
  taker: TEST_TAKER,
};
const base = { signedTransaction: "AQAB", requestId: "test-request-id" };

describe("Jupiter order and execute — sign-in required", () => {
  it("refuses anonymous callers on both routes", async () => {
    const o = await api<OrderResponse>("/api/jupiter/order", { method: "POST", body: validOrder });
    expect(o.status).toBe(401);
    const e = await api<{ error?: string }>("/api/jupiter/execute", { method: "POST", body: base });
    expect(e.status).toBe(401);
    assertNoSecretLeak(o.raw + e.raw);
  });

  it("refuses a forged token on both routes", async () => {
    expect((await order(validOrder, FORGED_TOKEN)).status).toBe(401);
    expect((await execute(base, FORGED_TOKEN)).status).toBe(401);
  });

  it("refuses key material even from anonymous callers without leaking anything", async () => {
    const res = await api<{ error?: string }>("/api/jupiter/execute", {
      method: "POST",
      body: { ...base, privateKey: "leak me" },
    });
    expect(res.status).toBe(401);
    expect(res.raw).not.toContain("leak me");
  });
});

// These need a real signed-in user of the dev project: set E2E_ACCESS_TOKEN.
describe.skipIf(!E2E_TOKEN)("POST /api/jupiter/order — guards (signed in)", () => {
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
      token: E2E_TOKEN,
    });
    expect(res.status).toBe(400);
  });

  it("answers with an unsigned transaction or Jupiter's error, never a stand-in", async () => {
    const status = await getIntegrationStatus();
    const res = await order(validOrder);
    assertNoSecretLeak(res.raw);

    if (providerMode(status, "Jupiter") !== "sandbox") {
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/not configured/);
      return;
    }
    // The system-program taker holds no SOL, so Jupiter usually refuses with
    // "Insufficient funds" (HTTP 200 + error upstream): that must surface as 502.
    expect([200, 502]).toContain(res.status);
    if (res.status === 200) {
      expect(typeof res.body.transaction).toBe("string");
      expect(res.body.requestId).toBeTruthy();
    } else {
      expect(res.body.error).toBeTruthy();
    }
  });
});

describe.skipIf(!E2E_TOKEN)(
  "POST /api/jupiter/execute — guards (signed in; never executes)",
  () => {
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
        const res = await execute({ ...base, [field]: "leak me" });
        expect(res.status, `field ${field} must be blocked`).toBe(400);
        expect(res.body.error).toMatch(/Private key or seed phrase/);
      }
    });

    it("rejects a non-base64 signed transaction", async () => {
      const res = await execute({ ...base, signedTransaction: "not base64 !!" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/base64/);
    });

    it("requires requestId", async () => {
      const res = await execute({ signedTransaction: "AQAB" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/requestId|Required/i);
    });

    it("rejects unknown extra fields", async () => {
      const res = await execute({ ...base, sneaky: true });
      expect(res.status).toBe(400);
    });

    it("rejects malformed JSON", async () => {
      const res = await api<{ error?: string }>("/api/jupiter/execute", {
        method: "POST",
        body: "{",
        token: E2E_TOKEN,
      });
      expect(res.status).toBe(400);
    });
  },
);
