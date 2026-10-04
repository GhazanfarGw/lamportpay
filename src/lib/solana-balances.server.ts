/**
 * Real mainnet holdings of a payer wallet, for the settlement decision and the
 * SOL check before anything is signed (docs/wallet-settlement-design.md).
 * Read-only RPC through `rpc()` (SOLANA_RPC_URL); no keys are involved. A failed
 * read is reported as "unavailable", never as zero, so no payment step is ever
 * decided on an invented balance.
 */
import { PublicKey } from "@solana/web3.js";

import { MODE_PROFILES } from "./app-mode";
import { currentMode } from "./app-mode.server";
import { activeCluster, rpc } from "./solana-rpc.server";
import { associatedTokenAddress, isValidPublicKey } from "./solana-usdc.server";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "./tokens";

/** Classic SPL Token program, which both payment mints use. */
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/** Size of a classic SPL token account; it fixes the rent-exempt minimum. */
const TOKEN_ACCOUNT_SIZE = 165;
/** Base fee per signature; the funding transaction has one signer, the payer. */
const LAMPORTS_PER_SIGNATURE = 5_000n;
const FUNDING_SIGNATURES = 1n;
/** Priority and compute-unit fee allowance for the funding transaction. */
const FUNDING_PRIORITY_ALLOWANCE_LAMPORTS = 50_000n;
/** Fee allowance for a Jupiter swap transaction, priority fee included. */
const SWAP_FEE_ALLOWANCE_LAMPORTS = 50_000n;
/** 0.002 SOL. */
const DEFAULT_FEE_RESERVE_MARGIN_LAMPORTS = 2_000_000n;
const DIGITS = /^\d+$/;

export type WalletHoldings =
  | {
      status: "ok";
      owner: string;
      slot: number | null;
      readAt: string;
      solLamports: bigint;
      tokens: Record<PaymentCurrency, bigint>;
    }
  | { status: "unavailable"; owner: string; reason: string };

export type SolReserveInput = {
  payer: string;
  depositOwner?: string | null;
  mint?: string | null;
  /** LamportPay's revenue wallet, when the funding transaction carries a fee leg. */
  feeOwner?: string | null;
  swap?: { outputMint: string; inputIsSol: boolean } | null;
};

type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * RPC call on the mode's cluster (TEST: devnet, LIVE: mainnet) that never
 * throws, so every failure takes the "unavailable" path.
 */
async function call(method: string, params: unknown[]): Promise<Read<unknown>> {
  try {
    const res = await rpc<unknown>(activeCluster(), method, params);
    return res.ok ? { ok: true, value: res.result } : { ok: false, reason: res.error };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "RPC call failed." };
  }
}

/** A lamport count from the RPC (a JSON integer) as bigint; null when malformed. */
function lamportsOf(value: unknown): bigint | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? BigInt(value) : null;
}

function slotOf(result: Record<string, unknown>): number | null {
  const context = result["context"];
  const slot = isRecord(context) ? context["slot"] : undefined;
  return typeof slot === "number" && Number.isSafeInteger(slot) && slot >= 0 ? slot : null;
}

async function readSol(owner: string): Promise<Read<{ lamports: bigint; slot: number | null }>> {
  const read = await call("getBalance", [owner, { commitment: "confirmed" }]);
  if (!read.ok) return { ok: false, reason: `SOL balance read failed: ${read.reason}` };
  const malformed = { ok: false, reason: "SOL balance read returned a malformed result." } as const;
  if (!isRecord(read.value)) return malformed;
  const lamports = lamportsOf(read.value["value"]);
  if (lamports === null) return malformed;
  return { ok: true, value: { lamports, slot: slotOf(read.value) } };
}

/**
 * Balance of `owner`'s associated token account for `mint`. No account is a
 * real zero. An account that is not `owner`'s initialized token account for this
 * mint under the Token program (foreign, frozen, re-assigned) cannot be spent by
 * the funding transaction, so it also counts as zero.
 */
async function readTokenBalance(
  owner: PublicKey,
  mint: string,
  symbol: string,
): Promise<Read<bigint>> {
  const malformed = {
    ok: false,
    reason: `${symbol} balance read returned a malformed result.`,
  } as const;
  const ata = associatedTokenAddress(owner, new PublicKey(mint)).toBase58();
  const read = await call("getAccountInfo", [
    ata,
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  if (!read.ok) return { ok: false, reason: `${symbol} balance read failed: ${read.reason}` };
  if (!isRecord(read.value) || !("value" in read.value)) return malformed;
  const account = read.value["value"];
  if (account === null) return { ok: true, value: 0n };
  if (!isRecord(account)) return malformed;

  const data = account["data"];
  const parsed = isRecord(data) ? data["parsed"] : undefined;
  const info = isRecord(parsed) ? parsed["info"] : undefined;
  const spendable =
    account["owner"] === TOKEN_PROGRAM_ID &&
    isRecord(parsed) &&
    parsed["type"] === "account" &&
    isRecord(info) &&
    info["mint"] === mint &&
    info["owner"] === owner.toBase58() &&
    info["state"] === "initialized";
  if (!spendable) return { ok: true, value: 0n };

  const tokenAmount = info["tokenAmount"];
  const amount = isRecord(tokenAmount) ? tokenAmount["amount"] : undefined;
  if (typeof amount !== "string" || !DIGITS.test(amount)) return malformed;
  return { ok: true, value: BigInt(amount) };
}

/** Real balances of `owner`: SOL, and the associated token account of each PAYMENT_CURRENCY_MINTS mint. Never invents a zero for a failed read. */
export async function readWalletHoldings(owner: string): Promise<WalletHoldings> {
  if (!isValidPublicKey(owner)) return { status: "unavailable", owner, reason: "invalid address" };
  const ownerKey = new PublicKey(owner);
  const canonical = ownerKey.toBase58();

  // The mode decides the assets: TEST reads devnet test USDC; LIVE reads real
  // mainnet coins. A coin with no asset in this mode (USDT on devnet) truly is 0.
  const mints = MODE_PROFILES[currentMode().mode].mints;
  const [sol, tokenReads] = await Promise.all([
    readSol(canonical),
    Promise.all(
      PAYMENT_CURRENCIES.map((currency): Promise<Read<bigint>> => {
        const mint = mints[currency];
        return mint
          ? readTokenBalance(ownerKey, mint, currency.toUpperCase())
          : Promise.resolve({ ok: true, value: 0n });
      }),
    ),
  ]);

  // All or nothing: a partial result would read as "holds none of that coin".
  const failures: string[] = [];
  if (!sol.ok) failures.push(sol.reason);
  const tokens = {} as Record<PaymentCurrency, bigint>;
  PAYMENT_CURRENCIES.forEach((currency, i) => {
    const read = tokenReads[i]!;
    if (read.ok) tokens[currency] = read.value;
    else failures.push(read.reason);
  });
  if (!sol.ok || failures.length > 0) {
    return { status: "unavailable", owner: canonical, reason: failures.join("; ") };
  }

  return {
    status: "ok",
    owner: canonical,
    slot: sol.value.slot,
    readAt: new Date().toISOString(),
    solLamports: sol.value.lamports,
    tokens,
  };
}

/** Program that owns `address`, or null when there is no account. */
async function readAccountProgram(address: string): Promise<Read<string | null>> {
  const read = await call("getAccountInfo", [
    address,
    { encoding: "base64", dataSlice: { offset: 0, length: 0 }, commitment: "confirmed" },
  ]);
  if (!read.ok) return read;
  if (!isRecord(read.value) || !("value" in read.value)) {
    return { ok: false, reason: "Account read returned a malformed result." };
  }
  const account = read.value["value"];
  if (account === null) return { ok: true, value: null };
  if (!isRecord(account) || typeof account["owner"] !== "string") {
    return { ok: false, reason: "Account read returned a malformed result." };
  }
  return { ok: true, value: account["owner"] };
}

/** Whether an account exists on mainnet; 'unavailable' when the RPC read failed. */
export async function accountExists(address: string): Promise<boolean | "unavailable"> {
  if (!isValidPublicKey(address)) return "unavailable";
  const read = await readAccountProgram(address);
  return read.ok ? read.value !== null : "unavailable";
}

/**
 * Whether creating `owner`'s token account for `mint` would cost rent. Anything
 * at that address other than a Token-program account (nothing, or lamports sent
 * there beforehand) still needs the rent-exempt deposit.
 */
async function tokenAccountNeedsRent(
  owner: string,
  mint: string,
): Promise<boolean | "unavailable"> {
  if (!isValidPublicKey(owner) || !isValidPublicKey(mint)) return "unavailable";
  const ata = associatedTokenAddress(new PublicKey(owner), new PublicKey(mint)).toBase58();
  const read = await readAccountProgram(ata);
  return read.ok ? read.value !== TOKEN_PROGRAM_ID : "unavailable";
}

let cachedTokenAccountRent: bigint | null = null;

/** Rent-exempt minimum for a token account (165 bytes), read from the chain and cached per process. Null when unreadable. */
export async function tokenAccountRentLamports(): Promise<bigint | null> {
  if (cachedTokenAccountRent !== null) return cachedTokenAccountRent;
  const read = await call("getMinimumBalanceForRentExemption", [
    TOKEN_ACCOUNT_SIZE,
    { commitment: "confirmed" },
  ]);
  const lamports = read.ok ? lamportsOf(read.value) : null;
  // Mainnet rent is never zero; a zero is a broken answer, not a price.
  if (lamports === null || lamports === 0n) return null;
  cachedTokenAccountRent = lamports;
  return lamports;
}

/** SOL the payer must keep for fees and rent before anything is signed. 'unavailable' when a needed read failed. */
export async function solReserveLamports(input: SolReserveInput): Promise<bigint | "unavailable"> {
  // Read first, so a bad config fails loudly instead of after network calls.
  const margin = solFeeReserveMarginLamports();
  if (!isValidPublicKey(input.payer)) return "unavailable";

  let lamports = LAMPORTS_PER_SIGNATURE * FUNDING_SIGNATURES + FUNDING_PRIORITY_ALLOWANCE_LAMPORTS;
  const rentChecks: Promise<boolean | "unavailable">[] = [];
  if (input.depositOwner != null && input.mint != null) {
    // The funding transaction creates Stables' deposit token account if missing, at the payer's cost.
    rentChecks.push(tokenAccountNeedsRent(input.depositOwner, input.mint));
  }
  if (input.feeOwner != null && input.mint != null) {
    // A LamportPay fee leg creates the revenue wallet's token account if missing.
    rentChecks.push(tokenAccountNeedsRent(input.feeOwner, input.mint));
  }
  if (input.swap) {
    lamports += SWAP_FEE_ALLOWANCE_LAMPORTS;
    rentChecks.push(tokenAccountNeedsRent(input.payer, input.swap.outputMint));
    // A SOL input is wrapped in a temporary token account for the swap.
    if (input.swap.inputIsSol) rentChecks.push(Promise.resolve(true));
  }

  const needsRent = await Promise.all(rentChecks);
  if (needsRent.includes("unavailable")) return "unavailable";
  const rentAccounts = BigInt(needsRent.filter((needed) => needed === true).length);
  if (rentAccounts > 0n) {
    const rent = await tokenAccountRentLamports();
    if (rent === null) return "unavailable";
    lamports += rent * rentAccounts;
  }
  return lamports + margin;
}

/** SOLANA_FEE_RESERVE_LAMPORTS from process.env, default 2000000 (0.002 SOL). Invalid config throws. */
export function solFeeReserveMarginLamports(): bigint {
  const raw = process.env["SOLANA_FEE_RESERVE_LAMPORTS"]?.trim();
  if (!raw) return DEFAULT_FEE_RESERVE_MARGIN_LAMPORTS;
  if (!DIGITS.test(raw)) {
    throw new Error(
      `SOLANA_FEE_RESERVE_LAMPORTS must be a whole number of lamports (2000000 is 0.002 SOL), not ${JSON.stringify(raw)}.`,
    );
  }
  return BigInt(raw);
}
