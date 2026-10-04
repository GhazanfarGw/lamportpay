import { createHash, randomBytes } from "node:crypto";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkSignedAgainstOrder,
  executeOrder,
  getOrder,
  swapReferralFrom,
  isJupiterConfigured,
  JupiterError,
  messageSha256,
} from "@/lib/jupiter/client.server";
import { SOL_MINT, USDC_MINT, USDT_MINT } from "@/lib/tokens";
import { LIVE_ENV } from "./support/app-mode";

vi.mock("@/lib/app-mode-lock", () => ({ LIVE_MODE_CODE_UNLOCKED: true }));

const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const taker = Keypair.generate();
const relayer = Keypair.generate();
const DESTINATION = Keypair.generate().publicKey;

/** A small real v0 transaction; `payer` signs first, `from` signs the transfer. */
function buildTx(
  payer: PublicKey,
  from: PublicKey,
  lamports = 1,
  blockhash = BLOCKHASH,
): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: from, toPubkey: DESTINATION, lamports })],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

const toBase64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");

function signedCopy(tx: VersionedTransaction, signers: Keypair[]): VersionedTransaction {
  const copy = VersionedTransaction.deserialize(tx.serialize());
  copy.sign(signers);
  return copy;
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Independent base58 decoder, to cross-check the client's encoder. */
function base58Decode(text: string): Uint8Array {
  let value = 0n;
  for (const ch of text) value = value * 58n + BigInt(ALPHABET.indexOf(ch));
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const ch of text) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** Taker pays its own fee (slot 0). */
const orderTx = buildTx(taker.publicKey, taker.publicKey);
const ORDER_B64 = toBase64(orderTx);
const SIGNED_B64 = toBase64(signedCopy(orderTx, [taker]));
const TX_SIGNATURE = "5".repeat(88);

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    swapType: "aggregator",
    inAmount: "816714356",
    outAmount: "100000000",
    otherAmountThreshold: "99750000",
    swapMode: "ExactIn",
    slippageBps: 25,
    priceImpactPct: "-0.0012",
    priceImpact: -0.12,
    routePlan: [
      { percent: 100, swapInfo: { label: "Meteora DLMM" } },
      { percent: 100, swapInfo: { label: "Whirlpool" } },
    ],
    feeMint: SOL_MINT,
    feeBps: 2,
    platformFee: { feeBps: 2, feeMint: SOL_MINT },
    signatureFeeLamports: 5000,
    signatureFeePayer: taker.publicKey.toBase58(),
    prioritizationFeeLamports: 1000,
    rentFeeLamports: 0,
    transaction: ORDER_B64,
    gasless: false,
    taker: taker.publicKey.toBase58(),
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    router: "metis",
    mode: "ultra",
    requestId: "req-1",
    lastValidBlockHeight: "352000000",
    inUsdValue: 100.1,
    outUsdValue: 100,
    transactionVersion: "0",
    totalTime: 120,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("JUPITER_API_KEY", "test-key");
  // Jupiter is mainnet-only: only a fully active LIVE MODE may call it (lock
  // mocked open above + the complete live fixture). TEST MODE is covered in
  // tests/app-mode.unit.test.ts.
  for (const [k, v] of Object.entries(LIVE_ENV)) vi.stubEnv(k, v);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function jupiterError(promise: Promise<unknown>): Promise<JupiterError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(JupiterError);
  return error as JupiterError;
}

const exactIn = {
  inputMint: SOL_MINT,
  outputMint: USDC_MINT,
  amount: 816_714_356n,
  taker: taker.publicKey.toBase58(),
};

describe("configuration", () => {
  it("is configured only with a non-empty key", () => {
    expect(isJupiterConfigured()).toBe(true);
    vi.stubEnv("JUPITER_API_KEY", "");
    expect(isJupiterConfigured()).toBe(false);
    vi.stubEnv("JUPITER_API_KEY", "   ");
    expect(isJupiterConfigured()).toBe(false);
  });

  it("refuses to call Jupiter without a key", async () => {
    vi.stubEnv("JUPITER_API_KEY", "");
    const orderError = await jupiterError(getOrder(exactIn));
    expect(orderError.status).toBe(503);
    const executeError = await jupiterError(
      executeOrder({ signedTransaction: SIGNED_B64, requestId: "req-1" }),
    );
    expect(executeError.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getOrder", () => {
  it("parses an ExactIn order with a taker and sends only the fixed parameters", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValueOnce(jsonResponse(orderBody()));

    const order = await getOrder(exactIn);

    expect(order).toEqual({
      requestId: "req-1",
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      swapMode: "ExactIn",
      inAmount: 816_714_356n,
      outAmount: 100_000_000n,
      otherAmountThreshold: 99_750_000n,
      slippageBps: 25,
      priceImpactPct: -0.0012,
      feeBps: 2,
      feeMint: SOL_MINT,
      gasless: false,
      taker: taker.publicKey.toBase58(),
      transaction: ORDER_B64,
      lastValidBlockHeight: 352_000_000n,
      router: "metis",
      mode: "ultra",
      routeLabels: ["Meteora DLMM", "Whirlpool"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe("https://api.jup.ag/swap/v2/order");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: "816714356",
      taker: taker.publicKey.toBase58(),
    });
    expect(init?.method).toBe("GET");
    expect(init?.headers).toEqual({ "x-api-key": "test-key", Accept: "application/json" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(15_000);
  });

  it("adds LamportPay's referral account and fee only when the server sets them", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(orderBody()));
    const referral = { account: relayer.publicKey.toBase58(), feeBps: 200 };
    await getOrder({ ...exactIn, referral });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get("referralAccount")).toBe(referral.account);
    expect(url.searchParams.get("referralFee")).toBe("200");

    for (const bad of [
      { account: "not-a-key", feeBps: 200 },
      { account: referral.account, feeBps: 30 },
      { account: referral.account, feeBps: 300 },
    ]) {
      await expect(getOrder({ ...exactIn, referral: bad })).rejects.toMatchObject({ status: 500 });
    }
  });

  it("builds the referral from JUPITER_REFERRAL_ACCOUNT and the swap fee", () => {
    const account = relayer.publicKey.toBase58();
    delete process.env["JUPITER_REFERRAL_ACCOUNT"];
    expect(swapReferralFrom(200)).toBeNull();
    process.env["JUPITER_REFERRAL_ACCOUNT"] = account;
    expect(swapReferralFrom(0)).toBeNull();
    expect(swapReferralFrom(200)).toEqual({ account, feeBps: 200 });
    process.env["JUPITER_REFERRAL_ACCOUNT"] = "bad";
    expect(() => swapReferralFrom(200)).toThrow(/not a valid Solana address/);
    delete process.env["JUPITER_REFERRAL_ACCOUNT"];
  });

  it("parses a read-only ExactOut quote without a taker", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        orderBody({
          swapMode: "ExactOut",
          inAmount: "816714356",
          outAmount: "100000000",
          otherAmountThreshold: "816714356",
          slippageBps: 0,
          transaction: "",
          taker: null,
          lastValidBlockHeight: undefined,
          mode: "manual",
          feeBps: undefined,
          feeMint: undefined,
          priceImpactPct: undefined,
        }),
      ),
    );

    const order = await getOrder({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: 100_000_000n,
      swapMode: "ExactOut",
    });

    expect(order.swapMode).toBe("ExactOut");
    expect(order.otherAmountThreshold).toBe(816_714_356n);
    expect(order.transaction).toBeNull();
    expect(order.taker).toBeNull();
    expect(order.lastValidBlockHeight).toBeNull();
    expect(order.mode).toBe("manual");
    expect(order.feeBps).toBe(2);
    expect(order.feeMint).toBe(SOL_MINT);
    expect(order.priceImpactPct).toBeNull();

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: "100000000",
      swapMode: "ExactOut",
    });
  });

  it("accepts a numeric lastValidBlockHeight and a gasless order signed first by the relayer", async () => {
    const gaslessTx = buildTx(relayer.publicKey, taker.publicKey);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        orderBody({ transaction: toBase64(gaslessTx), gasless: true, lastValidBlockHeight: 352 }),
      ),
    );
    const order = await getOrder(exactIn);
    expect(order.gasless).toBe(true);
    expect(order.lastValidBlockHeight).toBe(352n);
  });

  it("treats an HTTP 200 carrying an error as a failed order", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        errorCode: 1,
        errorMessage: "Insufficient funds",
        error: "Insufficient funds",
        requestId: "req-2",
        inAmount: "816714356",
        outAmount: "100000000",
        transaction: null,
      }),
    );
    const error = await jupiterError(getOrder(exactIn));
    expect(error.status).toBe(422);
    expect(error.code).toBe(1);
    expect(error.message).toBe("Insufficient funds");
  });

  it("fails when a taker was given but no transaction came back", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(orderBody({ transaction: null })));
    expect((await jupiterError(getOrder(exactIn))).status).toBe(422);
    fetchMock.mockResolvedValueOnce(jsonResponse(orderBody({ transaction: "" })));
    expect((await jupiterError(getOrder(exactIn))).status).toBe(422);
  });

  it("maps HTTP errors: 5xx and 429 are temporary, others are bad answers", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Invalid outputMint" }, 400));
    let error = await jupiterError(getOrder(exactIn));
    expect(error.status).toBe(502);
    expect(error.message).toBe("Invalid outputMint");

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Too many requests" }, 429));
    error = await jupiterError(getOrder(exactIn));
    expect(error.status).toBe(503);
    expect(error.message).toBe("Too many requests");

    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    error = await jupiterError(getOrder(exactIn));
    expect(error.status).toBe(503);
    expect(error.message).toBe("Jupiter request failed (502).");
  });

  it("maps timeouts and network errors to a temporary failure", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    let error = await jupiterError(getOrder(exactIn));
    expect(error.status).toBe(503);
    expect(error.message).toMatch(/did not respond in time/);

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    error = await jupiterError(getOrder(exactIn));
    expect(error.status).toBe(503);
    expect(error.message).toMatch(/Could not reach Jupiter/);
  });

  it.each([
    ["a fractional amount", { inAmount: "1.5" }],
    ["a numeric amount", { outAmount: 100000000 }],
    ["a negative threshold", { otherAmountThreshold: "-1" }],
    ["an amount above u64", { inAmount: "18446744073709551616" }],
    ["a string slippage", { slippageBps: "25" }],
    ["a bad block height", { lastValidBlockHeight: "soon" }],
    ["no request id", { requestId: undefined }],
    ["another output mint", { outputMint: USDT_MINT }],
    ["another input mint", { inputMint: USDT_MINT }],
    ["another swap mode", { swapMode: "ExactOut" }],
    ["another taker", { taker: relayer.publicKey.toBase58() }],
    ["a malformed transaction", { transaction: "AAAA" }],
    [
      "a transaction the taker does not sign",
      { transaction: toBase64(buildTx(relayer.publicKey, relayer.publicKey)) },
    ],
  ])("rejects %s as an unexpected response", async (_label, overrides) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(orderBody(overrides)));
    const error = await jupiterError(getOrder(exactIn));
    expect(error.status).toBe(502);
    expect(error.message).toBe("Unexpected Jupiter response.");
  });

  it("rejects an unreadable 200 body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    expect((await jupiterError(getOrder(exactIn))).status).toBe(502);
  });

  it.each([
    ["a zero amount", { amount: 0n }],
    ["a negative amount", { amount: -1n }],
    ["an invalid taker", { taker: "not-a-wallet!" }],
    ["a taker that is not a key", { taker: "1".repeat(44) }],
    ["a non-payment output", { outputMint: SOL_MINT }],
    ["the same mint in and out", { inputMint: USDC_MINT, outputMint: USDC_MINT }],
    ["an unknown input mint", { inputMint: DESTINATION.toBase58() }],
  ])("refuses %s before calling Jupiter", async (_label, overrides) => {
    const error = await jupiterError(getOrder({ ...exactIn, ...overrides }));
    expect(error.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("executeOrder", () => {
  const input = { signedTransaction: SIGNED_B64, requestId: "req-1" };

  it("relays only the signed transaction and request id, and parses success", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: "Success",
        signature: TX_SIGNATURE,
        code: 0,
        totalInputAmount: "816714356",
        totalOutputAmount: "100100000",
        inputAmountResult: "816714356",
        outputAmountResult: "100100000",
      }),
    );

    expect(await executeOrder(input)).toEqual({
      status: "Success",
      signature: TX_SIGNATURE,
      code: 0,
      error: null,
      inputAmountResult: 816_714_356n,
      outputAmountResult: 100_100_000n,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.jup.ag/swap/v2/execute");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "x-api-key": "test-key",
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns a reported failure instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: "Failed",
        signature: TX_SIGNATURE,
        code: -1005,
        error: "Transaction expired",
      }),
    );
    expect(await executeOrder(input)).toEqual({
      status: "Failed",
      signature: TX_SIGNATURE,
      code: -1005,
      error: "Transaction expired",
      inputAmountResult: null,
      outputAmountResult: null,
    });
  });

  it("throws 502 (outcome unknown) on network errors and timeouts", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    let error = await jupiterError(executeOrder(input));
    expect(error.status).toBe(502);
    expect(error.message).toMatch(/may still land/);

    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    error = await jupiterError(executeOrder(input));
    expect(error.status).toBe(502);
    expect(error.message).toMatch(/may still land/);
  });

  it("maps HTTP errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "upstream down" }, 500));
    expect((await jupiterError(executeOrder(input))).status).toBe(503);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "bad request" }, 400));
    expect((await jupiterError(executeOrder(input))).status).toBe(502);
  });

  it.each([
    ["no status", { signature: TX_SIGNATURE }],
    ["an unknown status", { status: "Pending", signature: TX_SIGNATURE }],
    ["success without a signature", { status: "Success" }],
    ["a malformed signature", { status: "Success", signature: "0xabc" }],
    ["a bad amount", { status: "Success", signature: TX_SIGNATURE, outputAmountResult: "1.5" }],
    ["a bad code", { status: "Failed", code: "oops" }],
  ])("throws 502 on %s", async (_label, body) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(body));
    expect((await jupiterError(executeOrder(input))).status).toBe(502);
  });

  it.each([
    ["an empty transaction", { signedTransaction: "" }],
    ["non-base64 text", { signedTransaction: "not base64!" }],
    ["an empty request id", { requestId: "" }],
  ])("refuses %s before calling Jupiter", async (_label, overrides) => {
    const error = await jupiterError(executeOrder({ ...input, ...overrides }));
    expect(error.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("messageSha256", () => {
  it("hashes the message bytes, so signing does not change it", () => {
    const expected = createHash("sha256").update(orderTx.message.serialize()).digest("hex");
    expect(messageSha256(ORDER_B64)).toBe(expected);
    expect(messageSha256(SIGNED_B64)).toBe(expected);
    expect(messageSha256(ORDER_B64)).toBe(messageSha256(ORDER_B64));
  });

  it("changes when the message changes", () => {
    const other = toBase64(buildTx(taker.publicKey, taker.publicKey, 2));
    expect(messageSha256(other)).not.toBe(messageSha256(ORDER_B64));
  });

  it("throws on a malformed transaction", () => {
    expect(() => messageSha256("not a transaction")).toThrow();
    expect(() => messageSha256(randomBytes(120).toString("base64"))).toThrow();
  });
});

describe("checkSignedAgainstOrder", () => {
  const takerKey = taker.publicKey.toBase58();

  it("accepts the order signed by the taker as fee payer", () => {
    const signed = signedCopy(orderTx, [taker]);
    const result = checkSignedAgainstOrder({
      signedTransaction: toBase64(signed),
      orderTransaction: ORDER_B64,
      taker: takerKey,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(base58Decode(result.signature)).toEqual(signed.signatures[0]);
    expect(result.transactionId).toBe(result.signature);
  });

  it("accepts a gasless order where the relayer pays and signs first", () => {
    const gasless = buildTx(relayer.publicKey, taker.publicKey);
    const signed = signedCopy(gasless, [taker]);
    const result = checkSignedAgainstOrder({
      signedTransaction: toBase64(signed),
      orderTransaction: toBase64(gasless),
      taker: takerKey,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(base58Decode(result.signature)).toEqual(signed.signatures[1]);
    // The relayer's signature (added by Jupiter) is the transaction id.
    expect(result.transactionId).toBeNull();
  });

  it("rejects a signed transaction whose message differs from the order", () => {
    for (const other of [
      buildTx(taker.publicKey, taker.publicKey, 2),
      buildTx(taker.publicKey, taker.publicKey, 1, Keypair.generate().publicKey.toBase58()),
    ]) {
      expect(
        checkSignedAgainstOrder({
          signedTransaction: toBase64(signedCopy(other, [taker])),
          orderTransaction: ORDER_B64,
          taker: takerKey,
        }),
      ).toEqual({ ok: false, reason: "message_mismatch" });
    }
  });

  it("rejects a transaction without the taker's signature", () => {
    expect(
      checkSignedAgainstOrder({
        signedTransaction: ORDER_B64,
        orderTransaction: ORDER_B64,
        taker: takerKey,
      }),
    ).toEqual({ ok: false, reason: "taker_signature_missing" });
  });

  it("rejects a non-zero signature that does not verify", () => {
    const forged = VersionedTransaction.deserialize(orderTx.serialize());
    forged.signatures[0] = Uint8Array.from(randomBytes(64));
    expect(
      checkSignedAgainstOrder({
        signedTransaction: toBase64(forged),
        orderTransaction: ORDER_B64,
        taker: takerKey,
      }),
    ).toEqual({ ok: false, reason: "taker_signature_missing" });
  });

  it("rejects when the taker is not a required signer", () => {
    const relayerOnly = buildTx(relayer.publicKey, relayer.publicKey);
    expect(
      checkSignedAgainstOrder({
        signedTransaction: toBase64(signedCopy(relayerOnly, [relayer])),
        orderTransaction: toBase64(relayerOnly),
        taker: takerKey,
      }),
    ).toEqual({ ok: false, reason: "taker_not_signer" });
  });

  it("rejects malformed input", () => {
    const withTrailingByte = Buffer.concat([Buffer.from(SIGNED_B64, "base64"), Buffer.from([0])]);
    for (const p of [
      { signedTransaction: "not base64!", orderTransaction: ORDER_B64, taker: takerKey },
      {
        signedTransaction: randomBytes(200).toString("base64"),
        orderTransaction: ORDER_B64,
        taker: takerKey,
      },
      {
        signedTransaction: withTrailingByte.toString("base64"),
        orderTransaction: ORDER_B64,
        taker: takerKey,
      },
      { signedTransaction: SIGNED_B64, orderTransaction: "", taker: takerKey },
      { signedTransaction: SIGNED_B64, orderTransaction: ORDER_B64, taker: "nope" },
    ]) {
      expect(checkSignedAgainstOrder(p)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("cross-checks the test's base58 decoder", () => {
    expect(base58Decode(taker.publicKey.toBase58())).toEqual(taker.publicKey.toBytes());
    expect(base58Decode(new PublicKey(new Uint8Array(32)).toBase58())).toEqual(new Uint8Array(32));
  });
});
