/**
 * Jupiter Swap API client for payment-bound swaps (server-side only).
 *
 * This is the only module in the payment flow that reads `JUPITER_API_KEY`.
 * It is deliberately strict: no mock fallback, no invented defaults, and it
 * never signs anything. Callers decide mints, amounts and taker from the
 * payment's settlement decision; nothing here accepts receiver fields from a
 * client. The only fee is LamportPay's own integrator fee (`referral`), set by
 * the server from business settings and JUPITER_REFERRAL_ACCOUNT, never by a
 * request.
 *
 * Verified 2026-09-28 against https://api.jup.ag/swap/v2: errors can come back
 * as HTTP 200 with `error` / `errorCode` / `errorMessage`, and in gasless
 * orders Jupiter's relayer is the fee payer (first signer), so the taker is
 * not assumed to be the fee payer anywhere below.
 */
import { createHash, createPublicKey, verify } from "node:crypto";

import { PACKET_DATA_SIZE, PublicKey, VersionedTransaction } from "@solana/web3.js";

import { PAYMENT_CURRENCY_MINTS, SOL_MINT } from "@/lib/tokens";

const ORDER_URL = "https://api.jup.ag/swap/v2/order";
const EXECUTE_URL = "https://api.jup.ag/swap/v2/execute";
const TIMEOUT_MS = 15_000;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const UINT_RE = /^\d{1,20}$/;
const U64_MAX = 18_446_744_073_709_551_615n;
/** Longest base64 text a transaction within the packet limit can take. */
const MAX_TRANSACTION_BASE64 = Math.ceil(PACKET_DATA_SIZE / 3) * 4;
const MAX_MESSAGE_LENGTH = 300;

export class JupiterError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Jupiter's own error code, when it sends one. */
    readonly code?: string | number,
  ) {
    super(message);
    this.name = "JupiterError";
  }
}

function apiKey(): string | null {
  const key = process.env.JUPITER_API_KEY?.trim();
  return key ? key : null;
}

export function isJupiterConfigured(): boolean {
  return apiKey() !== null;
}

function requireApiKey(): string {
  const key = apiKey();
  if (!key) throw new JupiterError("Swaps are not configured.", 503);
  return key;
}

export type JupiterOrder = {
  requestId: string;
  inputMint: string;
  outputMint: string;
  swapMode: "ExactIn" | "ExactOut";
  inAmount: bigint;
  outAmount: bigint;
  /** ExactIn: the minimum output. ExactOut: the maximum input. Base units. */
  otherAmountThreshold: bigint;
  slippageBps: number;
  /** As Jupiter reports it; informational only. */
  priceImpactPct: number | null;
  feeBps: number | null;
  feeMint: string | null;
  /** True when Jupiter's relayer pays the network fee and signs first. */
  gasless: boolean;
  taker: string | null;
  /** Unsigned base64 v0 transaction; null for a read-only quote. */
  transaction: string | null;
  lastValidBlockHeight: bigint | null;
  router: string | null;
  mode: string | null;
  routeLabels: string[];
};

/** Mints a payment swap may produce: the payment stablecoins only. */
const OUTPUT_MINTS: readonly string[] = Object.values(PAYMENT_CURRENCY_MINTS);
/** Mints a payment swap may spend: SOL or another payment stablecoin. */
const INPUT_MINTS: readonly string[] = [SOL_MINT, ...OUTPUT_MINTS];

function isPublicKey(value: string): boolean {
  if (!BASE58_RE.test(value)) return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
}

function unexpected(): JupiterError {
  return new JupiterError("Unexpected Jupiter response.", 502);
}

/** Base-unit amount from a digit string (Jupiter sends amounts as strings). */
function amountFrom(value: unknown): bigint | null {
  if (typeof value !== "string" || !UINT_RE.test(value)) return null;
  const amount = BigInt(value);
  return amount <= U64_MAX ? amount : null;
}

/** Like `amountFrom`, but also accepts a safe integer number. */
function uintFrom(value: unknown): bigint | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  return amountFrom(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** Jupiter's error message and code from any response body shape it uses. */
function errorDetails(body: Record<string, unknown>): {
  message: string | null;
  code?: string | number;
} {
  const message =
    optionalString(body.errorMessage) ?? optionalString(body.error) ?? optionalString(body.message);
  const rawCode = body.errorCode ?? body.code;
  const code =
    typeof rawCode === "number" || (typeof rawCode === "string" && rawCode !== "")
      ? rawCode
      : undefined;
  return { message: message === null ? null : truncate(message), code };
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** 5xx and 429 are temporary (503, try again); anything else is a bad answer (502). */
function httpError(response: Response, body: Record<string, unknown> | null): JupiterError {
  const temporary = response.status >= 500 || response.status === 429;
  const { message, code } = errorDetails(body ?? {});
  return new JupiterError(
    message ?? `Jupiter request failed (${response.status}).`,
    temporary ? 503 : 502,
    code,
  );
}

function isTimeout(e: unknown): boolean {
  const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : undefined;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Decode a base64 transaction strictly: canonical base64, within the packet
 * size limit, a v0 message, and no trailing or non-canonical bytes (it must
 * re-serialize to exactly the bytes given). Null when any check fails.
 */
function parseTransaction(transactionBase64: string): VersionedTransaction | null {
  if (
    typeof transactionBase64 !== "string" ||
    transactionBase64.length === 0 ||
    transactionBase64.length > MAX_TRANSACTION_BASE64 ||
    transactionBase64.length % 4 !== 0 ||
    !BASE64_RE.test(transactionBase64)
  ) {
    return null;
  }
  const raw = Buffer.from(transactionBase64, "base64");
  if (raw.length === 0 || raw.length > PACKET_DATA_SIZE) return null;
  try {
    const transaction = VersionedTransaction.deserialize(raw);
    if (transaction.version !== 0) return null;
    if (!Buffer.from(transaction.serialize()).equals(raw)) return null;
    return transaction;
  } catch {
    return null;
  }
}

/** Index of `taker` among the transaction's required signers, or -1. */
function signerIndex(transaction: VersionedTransaction, taker: string): number {
  const { staticAccountKeys, header } = transaction.message;
  for (let i = 0; i < header.numRequiredSignatures && i < staticAccountKeys.length; i++) {
    if (staticAccountKeys[i]!.toBase58() === taker) return i;
  }
  return -1;
}

/** LamportPay's Jupiter integrator fee: its referral account and fee (50–255 bps). */
export type SwapReferral = { account: string; feeBps: number };

/**
 * The referral to attach to swap orders, from JUPITER_REFERRAL_ACCOUNT and the
 * effective swap fee. Null (no fee) when either is unset: the fee only starts
 * once the owner has created the referral account with the company wallet.
 */
export function swapReferralFrom(swapFeeBps: number): SwapReferral | null {
  const account = process.env["JUPITER_REFERRAL_ACCOUNT"]?.trim();
  if (!account || swapFeeBps === 0) return null;
  if (!isPublicKey(account)) {
    throw new JupiterError("JUPITER_REFERRAL_ACCOUNT is not a valid Solana address.", 500);
  }
  return { account, feeBps: swapFeeBps };
}

/**
 * GET /swap/v2/order. With a taker a transaction is required; without one this is a read-only quote.
 *
 * The caller owns the money checks (minimum output against the shortfall,
 * maximum input against the balance, slippage and price impact limits); this
 * only guarantees the order is well formed, for the mints and taker asked, and
 * that the taker is a required signer of the returned transaction. Network
 * failures and timeouts throw 503: nothing was ordered, so a retry is safe.
 */
export async function getOrder(p: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  swapMode?: "ExactIn" | "ExactOut";
  taker?: string;
  /** LamportPay's integrator fee (server configuration only); null for none. */
  referral?: SwapReferral | null;
}): Promise<JupiterOrder> {
  const swapMode = p.swapMode ?? "ExactIn";
  const referral = p.referral ?? null;
  if (
    referral &&
    (!isPublicKey(referral.account) ||
      !Number.isInteger(referral.feeBps) ||
      referral.feeBps < 50 ||
      referral.feeBps > 255)
  ) {
    throw new JupiterError("Invalid referral configuration.", 500);
  }
  if (swapMode !== "ExactIn" && swapMode !== "ExactOut") {
    throw new JupiterError("Invalid swap mode.", 400);
  }
  if (typeof p.amount !== "bigint" || p.amount <= 0n || p.amount > U64_MAX) {
    throw new JupiterError("Swap amount must be a positive whole number of base units.", 400);
  }
  if (!INPUT_MINTS.includes(p.inputMint)) {
    throw new JupiterError("This coin can't be swapped for a payment.", 400);
  }
  if (!OUTPUT_MINTS.includes(p.outputMint) || p.outputMint === p.inputMint) {
    throw new JupiterError("A payment swap must produce a different payment coin.", 400);
  }
  if (p.taker !== undefined && !isPublicKey(p.taker)) {
    throw new JupiterError("Invalid wallet address.", 400);
  }
  const key = requireApiKey();

  const url = new URL(ORDER_URL);
  url.searchParams.set("inputMint", p.inputMint);
  url.searchParams.set("outputMint", p.outputMint);
  url.searchParams.set("amount", p.amount.toString());
  // Only sent when needed: extra parameters can switch Jupiter out of its default mode.
  if (swapMode === "ExactOut") url.searchParams.set("swapMode", "ExactOut");
  if (p.taker !== undefined) url.searchParams.set("taker", p.taker);
  if (referral) {
    url.searchParams.set("referralAccount", referral.account);
    url.searchParams.set("referralFee", String(referral.feeBps));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new JupiterError(
      isTimeout(e) ? "Jupiter did not respond in time." : "Could not reach Jupiter.",
      503,
    );
  }

  const body = await readJson(response);
  if (!response.ok) throw httpError(response, body);
  if (!body) throw unexpected();

  // Jupiter reports "no route", "insufficient funds" and similar as HTTP 200.
  if (isPresent(body.error) || isPresent(body.errorCode) || isPresent(body.errorMessage)) {
    const { message, code } = errorDetails(body);
    throw new JupiterError(message ?? "Jupiter could not build this swap.", 422, code);
  }

  const requestId = optionalString(body.requestId);
  const inAmount = amountFrom(body.inAmount);
  const outAmount = amountFrom(body.outAmount);
  const otherAmountThreshold = amountFrom(body.otherAmountThreshold);
  const slippageBps = body.slippageBps;
  if (
    requestId === null ||
    inAmount === null ||
    outAmount === null ||
    otherAmountThreshold === null ||
    typeof slippageBps !== "number" ||
    !Number.isSafeInteger(slippageBps) ||
    slippageBps < 0 ||
    body.swapMode !== swapMode ||
    body.inputMint !== p.inputMint ||
    body.outputMint !== p.outputMint
  ) {
    throw unexpected();
  }

  const taker = optionalString(body.taker);
  if (p.taker !== undefined && taker !== null && taker !== p.taker) throw unexpected();

  const transaction = optionalString(body.transaction);
  if (p.taker !== undefined && transaction === null) {
    throw new JupiterError("Jupiter returned no transaction to sign.", 422);
  }
  if (transaction !== null) {
    const parsed = parseTransaction(transaction);
    if (!parsed) throw unexpected();
    // The order must spend from the taker's wallet, so the taker has to sign it.
    if (p.taker !== undefined && signerIndex(parsed, p.taker) < 0) throw unexpected();
  }

  let lastValidBlockHeight: bigint | null = null;
  if (isPresent(body.lastValidBlockHeight)) {
    lastValidBlockHeight = uintFrom(body.lastValidBlockHeight);
    if (lastValidBlockHeight === null) throw unexpected();
  }

  const platformFee =
    body.platformFee && typeof body.platformFee === "object"
      ? (body.platformFee as Record<string, unknown>)
      : {};
  const routeLabels = Array.isArray(body.routePlan)
    ? body.routePlan.flatMap((step: unknown) => {
        const info = (step as { swapInfo?: { label?: unknown } } | null)?.swapInfo;
        return typeof info?.label === "string" ? [info.label] : [];
      })
    : [];

  return {
    requestId,
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    swapMode,
    inAmount,
    outAmount,
    otherAmountThreshold,
    slippageBps,
    priceImpactPct: optionalNumber(body.priceImpactPct),
    feeBps: optionalNumber(body.feeBps) ?? optionalNumber(platformFee.feeBps),
    feeMint: optionalString(body.feeMint) ?? optionalString(platformFee.feeMint),
    gasless: body.gasless === true,
    taker: p.taker ?? null,
    transaction,
    lastValidBlockHeight,
    router: optionalString(body.router),
    mode: optionalString(body.mode),
    routeLabels,
  };
}

export type JupiterExecution = {
  status: "Success" | "Failed";
  /** The transaction id Jupiter broadcast (the fee payer's signature). */
  signature: string | null;
  code: number | null;
  error: string | null;
  inputAmountResult: bigint | null;
  outputAmountResult: bigint | null;
};

/**
 * POST /swap/v2/execute. Relays a user-signed transaction; never signs anything itself.
 *
 * Every throw means the outcome is UNKNOWN, never "failed": the transaction
 * may already have been broadcast and can still land until its
 * `lastValidBlockHeight` passes. That includes network errors and timeouts
 * (502), HTTP errors (502, or 503 for 5xx/429) and unreadable answers (502).
 * Even a returned result is Jupiter's report only; the on-chain balance change
 * at finalized decides what actually happened.
 */
export async function executeOrder(p: {
  signedTransaction: string;
  requestId: string;
}): Promise<JupiterExecution> {
  if (
    typeof p.signedTransaction !== "string" ||
    p.signedTransaction.length === 0 ||
    p.signedTransaction.length > MAX_TRANSACTION_BASE64 ||
    p.signedTransaction.length % 4 !== 0 ||
    !BASE64_RE.test(p.signedTransaction)
  ) {
    throw new JupiterError("signedTransaction must be a base64 transaction.", 400);
  }
  if (typeof p.requestId !== "string" || p.requestId.length === 0 || p.requestId.length > 200) {
    throw new JupiterError("requestId is required.", 400);
  }
  const key = requireApiKey();

  let response: Response;
  try {
    response = await fetch(EXECUTE_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ signedTransaction: p.signedTransaction, requestId: p.requestId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new JupiterError(
      isTimeout(e)
        ? "Jupiter did not answer in time; the swap may still land."
        : "Could not reach Jupiter; the swap may still land.",
      502,
    );
  }

  const body = await readJson(response);
  if (!response.ok) throw httpError(response, body);
  const status = body?.status;
  if (!body || (status !== "Success" && status !== "Failed")) throw unexpected();

  const signature = optionalString(body.signature);
  if (signature !== null && !BASE58_SIGNATURE_RE.test(signature)) throw unexpected();
  if (status === "Success" && signature === null) throw unexpected();

  let code: number | null = null;
  if (isPresent(body.code)) {
    const parsed = optionalNumber(body.code);
    if (parsed === null || !Number.isInteger(parsed)) throw unexpected();
    code = parsed;
  }

  const results: Array<bigint | null> = [];
  for (const field of [body.inputAmountResult, body.outputAmountResult]) {
    if (!isPresent(field)) {
      results.push(null);
      continue;
    }
    const value = uintFrom(field);
    if (value === null) throw unexpected();
    results.push(value);
  }

  const error = optionalString(body.error);
  return {
    status,
    signature,
    code,
    error: error === null ? null : truncate(error),
    inputAmountResult: results[0]!,
    outputAmountResult: results[1]!,
  };
}

/** sha256 hex of the serialized v0 message of a base64 transaction (what the user is asked to sign). */
export function messageSha256(transactionBase64: string): string {
  const transaction = parseTransaction(transactionBase64);
  if (!transaction) throw new Error("Malformed transaction.");
  return createHash("sha256").update(transaction.message.serialize()).digest("hex");
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 (Bitcoin alphabet), as Solana writes signatures. */
function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = BASE58_ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** Ed25519 check of `signature` by `publicKey` over `message`. */
function verifySignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: PublicKey,
): boolean {
  try {
    const key = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: Buffer.from(publicKey.toBytes()).toString("base64url"),
      },
      format: "jwk",
    });
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}

/**
 * Check a user-signed transaction against the order: same message bytes as the order's transaction, and the taker's signature slot is present (non-zero). Returns the reason on failure. Fee payer may be Jupiter's relayer (gasless), so do not require the taker to be the fee payer.
 *
 * The taker's signature must also verify over the message (a non-zero but
 * invalid one counts as `taker_signature_missing`). `signature` is the
 * taker's signature; it is also the transaction id only when the taker is
 * the fee payer, so `transactionId` is null in gasless orders, where the id is
 * the relayer's signature and becomes known only from `executeOrder`.
 */
export function checkSignedAgainstOrder(p: {
  signedTransaction: string;
  orderTransaction: string;
  taker: string;
}):
  | { ok: true; signature: string; transactionId: string | null }
  | {
      ok: false;
      reason: "malformed" | "message_mismatch" | "taker_not_signer" | "taker_signature_missing";
    } {
  const signed = parseTransaction(p.signedTransaction);
  const order = parseTransaction(p.orderTransaction);
  if (!signed || !order || !isPublicKey(p.taker)) return { ok: false, reason: "malformed" };

  const message = signed.message.serialize();
  if (!Buffer.from(message).equals(Buffer.from(order.message.serialize()))) {
    return { ok: false, reason: "message_mismatch" };
  }

  const index = signerIndex(signed, p.taker);
  if (index < 0) return { ok: false, reason: "taker_not_signer" };

  const signature = signed.signatures[index];
  if (
    !signature ||
    signature.every((byte) => byte === 0) ||
    !verifySignature(message, signature, new PublicKey(p.taker))
  ) {
    return { ok: false, reason: "taker_signature_missing" };
  }

  const encoded = base58(signature);
  return { ok: true, signature: encoded, transactionId: index === 0 ? encoded : null };
}
