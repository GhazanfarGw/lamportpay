/**
 * Standalone /swap relay: only an order the server issued to this user, with
 * that order's exact message and taker signature, is relayed, and only once.
 * Jupiter is mocked; nothing is signed or sent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", async () => {
  const { createFakeSupabase } = await import("./support/fake-supabase");
  return { supabaseAdmin: createFakeSupabase() };
});
vi.mock("@/lib/jupiter/client.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jupiter/client.server")>();
  return {
    ...actual,
    getOrder: vi.fn(),
    executeOrder: vi.fn(),
    checkSignedAgainstOrder: vi.fn(),
  };
});

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import * as jupiter from "@/lib/jupiter/client.server";
import {
  SWAP_ORDER_TTL_MS,
  SwapOrderError,
  issueSwapOrder,
  relaySwapOrder,
} from "@/lib/jupiter/swap-orders.server";
import { SOL_MINT, USDC_MINT } from "@/lib/tokens";
import type { FakeSupabase } from "./support/fake-supabase";

const db = supabaseAdmin as unknown as FakeSupabase;
const api = vi.mocked(jupiter);

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TAKER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const SIGNATURE = "5".repeat(88);

function jupiterOrder(requestId = "req-1") {
  return {
    requestId,
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    swapMode: "ExactIn" as const,
    inAmount: 5_000_000n,
    outAmount: 750_000n,
    otherAmountThreshold: 740_000n,
    slippageBps: 50,
    priceImpactPct: null,
    feeBps: null,
    feeMint: null,
    gasless: false,
    taker: TAKER,
    transaction: "AQID",
    lastValidBlockHeight: 123n,
    router: null,
    mode: null,
    routeLabels: [],
  };
}

async function issue(requestId = "req-1") {
  api.getOrder.mockResolvedValueOnce(jupiterOrder(requestId));
  return issueSwapOrder({ userId: USER, taker: TAKER, lamports: 5_000_000n });
}

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected a refusal");
    },
    (e: unknown) => e as SwapOrderError,
  );

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
  api.checkSignedAgainstOrder.mockReturnValue({
    ok: true,
    signature: SIGNATURE,
    transactionId: SIGNATURE,
  });
  api.executeOrder.mockResolvedValue({
    status: "Success",
    signature: SIGNATURE,
    code: null,
    error: null,
    inputAmountResult: 5_000_000n,
    outputAmountResult: 749_000n,
  });
});

describe("issueSwapOrder", () => {
  it("orders SOL → USDC for the taker and stores it for the user", async () => {
    const issued = await issue();
    expect(api.getOrder).toHaveBeenCalledWith({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: 5_000_000n,
      taker: TAKER,
      // No LamportPay swap fee until the referral account exists.
      referral: null,
    });
    expect(issued).toEqual({
      transaction: "AQID",
      requestId: "req-1",
      outAmount: "750000",
      lastValidBlockHeight: "123",
    });
    const [row] = db.table("jupiter_swap_orders");
    expect(row).toMatchObject({
      user_id: USER,
      taker: TAKER,
      jupiter_request_id: "req-1",
      order_transaction: "AQID",
      status: "ordered",
    });
  });

  it("stores nothing when Jupiter refuses", async () => {
    api.getOrder.mockRejectedValueOnce(new jupiter.JupiterError("Insufficient funds", 422));
    await expect(
      issueSwapOrder({ userId: USER, taker: TAKER, lamports: 5_000_000n }),
    ).rejects.toThrow("Insufficient funds");
    expect(db.table("jupiter_swap_orders")).toHaveLength(0);
  });
});

describe("relaySwapOrder", () => {
  it("relays an issued order once and records the result", async () => {
    await issue();
    const result = await relaySwapOrder({
      userId: USER,
      requestId: "req-1",
      signedTransaction: "AQIDBA==",
    });
    expect(result.status).toBe("Success");
    expect(api.checkSignedAgainstOrder).toHaveBeenCalledWith({
      signedTransaction: "AQIDBA==",
      orderTransaction: "AQID",
      taker: TAKER,
    });
    expect(api.executeOrder).toHaveBeenCalledTimes(1);
    expect(db.table("jupiter_swap_orders")[0]).toMatchObject({
      status: "relayed",
      signature: SIGNATURE,
      jupiter_status: "Success",
    });
  });

  it("never relays the same order twice", async () => {
    await issue();
    const input = { userId: USER, requestId: "req-1", signedTransaction: "AQIDBA==" };
    await relaySwapOrder(input);
    const second = await refusal(relaySwapOrder(input));
    expect(second.status).toBe(409);
    expect(api.executeOrder).toHaveBeenCalledTimes(1);
  });

  it("lets only one of two concurrent relays through", async () => {
    await issue();
    const input = { userId: USER, requestId: "req-1", signedTransaction: "AQIDBA==" };
    const results = await Promise.allSettled([relaySwapOrder(input), relaySwapOrder(input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(api.executeOrder).toHaveBeenCalledTimes(1);
  });

  it("refuses a request ID the server never issued", async () => {
    const e = await refusal(
      relaySwapOrder({ userId: USER, requestId: "forged", signedTransaction: "AQIDBA==" }),
    );
    expect(e.status).toBe(404);
    expect(api.executeOrder).not.toHaveBeenCalled();
  });

  it("refuses another user's order with the same answer as an unknown one", async () => {
    await issue();
    const e = await refusal(
      relaySwapOrder({ userId: OTHER, requestId: "req-1", signedTransaction: "AQIDBA==" }),
    );
    expect(e.status).toBe(404);
    expect(api.executeOrder).not.toHaveBeenCalled();
    expect(db.table("jupiter_swap_orders")[0]!["status"]).toBe("ordered");
  });

  it("refuses a transaction whose message differs from the order", async () => {
    await issue();
    api.checkSignedAgainstOrder.mockReturnValueOnce({ ok: false, reason: "message_mismatch" });
    const e = await refusal(
      relaySwapOrder({ userId: USER, requestId: "req-1", signedTransaction: "AQIDBA==" }),
    );
    expect(e.status).toBe(400);
    expect(api.executeOrder).not.toHaveBeenCalled();
    expect(db.table("jupiter_swap_orders")[0]!["status"]).toBe("ordered");
  });

  it("refuses a transaction the taker did not sign", async () => {
    await issue();
    api.checkSignedAgainstOrder.mockReturnValueOnce({
      ok: false,
      reason: "taker_signature_missing",
    });
    const e = await refusal(
      relaySwapOrder({ userId: USER, requestId: "req-1", signedTransaction: "AQIDBA==" }),
    );
    expect(e.status).toBe(400);
    expect(api.executeOrder).not.toHaveBeenCalled();
  });

  it("refuses an expired order", async () => {
    await issue();
    db.table("jupiter_swap_orders")[0]!["expires_at"] = new Date(
      Date.now() - SWAP_ORDER_TTL_MS,
    ).toISOString();
    const e = await refusal(
      relaySwapOrder({ userId: USER, requestId: "req-1", signedTransaction: "AQIDBA==" }),
    );
    expect(e.status).toBe(409);
    expect(api.executeOrder).not.toHaveBeenCalled();
  });

  it("keeps an order whose relay outcome is unknown from being sent again", async () => {
    await issue();
    api.executeOrder.mockRejectedValueOnce(
      new jupiter.JupiterError("Jupiter did not answer in time; the swap may still land.", 502),
    );
    const input = { userId: USER, requestId: "req-1", signedTransaction: "AQIDBA==" };
    await expect(relaySwapOrder(input)).rejects.toThrow(/may still land/);
    expect(db.table("jupiter_swap_orders")[0]).toMatchObject({
      status: "relayed",
      jupiter_status: "unknown",
    });
    const retry = await refusal(relaySwapOrder(input));
    expect(retry.status).toBe(409);
    expect(api.executeOrder).toHaveBeenCalledTimes(1);
  });

  it("reports Jupiter's failure from its answer, not as success", async () => {
    await issue();
    api.executeOrder.mockResolvedValueOnce({
      status: "Failed",
      signature: SIGNATURE,
      code: -1,
      error: "Slippage exceeded",
      inputAmountResult: null,
      outputAmountResult: null,
    });
    const result = await relaySwapOrder({
      userId: USER,
      requestId: "req-1",
      signedTransaction: "AQIDBA==",
    });
    expect(result.status).toBe("Failed");
    expect(db.table("jupiter_swap_orders")[0]).toMatchObject({
      status: "relayed",
      jupiter_status: "Failed",
      jupiter_error: "Slippage exceeded",
    });
  });
});
