/**
 * LamportPay's own fees (Phase 3 revenue engine). Configuration only — never
 * hard-coded in business logic. The .env values are the defaults:
 *   LAMPORTPAY_FEE_BPS          conversion fee, basis points (200 = 2%)
 *   LAMPORTPAY_SWAP_FEE_BPS     Jupiter integrator fee on swaps (Jupiter allows 50–255
 *                               and keeps 20% of it)
 *   LAMPORTPAY_REVENUE_WALLET   Solana address that receives LamportPay's fee only
 *   PAYMENT_ENABLED_CURRENCIES  comma list of payment coins (default "usdc,usdt")
 * An admin can override each one from the admin dashboard (business_settings,
 * see business-settings.server.ts); the effective value is what payments use.
 *
 * Non-custodial by design: the fee is added ON TOP of the amount Stables quotes and
 * is paid in the same user-signed transaction as a separate transfer to the revenue
 * wallet. The Stables deposit itself goes straight from the user's wallet to Stables;
 * customer funds never pass through a LamportPay wallet.
 *
 * Unset fee variables mean "no LamportPay fee" (the Phase 2 flow is unchanged).
 */
import { PublicKey } from "@solana/web3.js";

import { PAYMENT_CURRENCIES, type PaymentCurrency } from "@/lib/tokens";

const BPS_DENOMINATOR = 10_000n;
const DIGITS = /^\d+$/;

export type FeeConfig = {
  conversionBps: bigint;
  swapBps: number;
  revenueWallet: string | null;
};

export const MAX_CONVERSION_FEE_BPS = 1_000;
export const MIN_SWAP_FEE_BPS = 50;
export const MAX_SWAP_FEE_BPS = 255;

function bps(name: string, max: number): bigint {
  const raw = process.env[name]?.trim();
  if (!raw) return 0n;
  if (!DIGITS.test(raw)) throw new Error(`${name} must be a whole number of basis points.`);
  const value = BigInt(raw);
  if (value > BigInt(max)) throw new Error(`${name} must be at most ${max} basis points.`);
  return value;
}

/** A Solana address, or throws with `label` in the message. */
export function checkWallet(wallet: string, label: string): string {
  try {
    // Base58 of 32 bytes; PublicKey also accepts other inputs, so check the shape too.
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new Error();
    new PublicKey(wallet);
  } catch {
    throw new Error(`${label} is not a valid Solana address.`);
  }
  return wallet;
}

/** 0 or Jupiter's 50–255 range, or throws. */
export function checkSwapBps(value: number, label: string): number {
  if (
    !Number.isInteger(value) ||
    (value !== 0 && (value < MIN_SWAP_FEE_BPS || value > MAX_SWAP_FEE_BPS))
  ) {
    throw new Error(
      `${label} must be 0 or between ${MIN_SWAP_FEE_BPS} and ${MAX_SWAP_FEE_BPS} basis points (Jupiter's range).`,
    );
  }
  return value;
}

/** .env defaults. Throws on invalid configuration, so a misconfigured fee never silently charges. */
export function getFeeConfig(): FeeConfig {
  const conversionBps = bps("LAMPORTPAY_FEE_BPS", MAX_CONVERSION_FEE_BPS);
  const swapRaw = process.env["LAMPORTPAY_SWAP_FEE_BPS"]?.trim();
  if (swapRaw && !DIGITS.test(swapRaw)) {
    throw new Error("LAMPORTPAY_SWAP_FEE_BPS must be a whole number of basis points.");
  }
  if (swapRaw && Number(swapRaw) > MAX_SWAP_FEE_BPS) {
    throw new Error(`LAMPORTPAY_SWAP_FEE_BPS must be at most ${MAX_SWAP_FEE_BPS} basis points.`);
  }
  const swapBps = checkSwapBps(swapRaw ? Number(swapRaw) : 0, "LAMPORTPAY_SWAP_FEE_BPS");
  const raw = process.env["LAMPORTPAY_REVENUE_WALLET"]?.trim() || null;
  const wallet = raw ? checkWallet(raw, "LAMPORTPAY_REVENUE_WALLET") : null;
  if (conversionBps > 0n && !wallet) {
    throw new Error("LAMPORTPAY_FEE_BPS is set but LAMPORTPAY_REVENUE_WALLET is not.");
  }
  return { conversionBps, swapBps, revenueWallet: wallet };
}

/**
 * Payment coins turned on, in the standard order. Unknown or empty entries
 * throw: a typo must not silently switch every coin off (or on).
 */
export function parseEnabledCurrencies(raw: readonly string[], label: string): PaymentCurrency[] {
  const wanted = new Set(raw.map((c) => c.trim().toLowerCase()).filter(Boolean));
  for (const coin of wanted) {
    if (!(PAYMENT_CURRENCIES as readonly string[]).includes(coin)) {
      throw new Error(`${label}: unknown payment coin ${JSON.stringify(coin)}.`);
    }
  }
  const enabled = PAYMENT_CURRENCIES.filter((c) => wanted.has(c));
  if (enabled.length === 0) throw new Error(`${label} must turn on at least one payment coin.`);
  return enabled;
}

/** PAYMENT_ENABLED_CURRENCIES from .env; unset means every coin. */
export function envEnabledCurrencies(): PaymentCurrency[] {
  const raw = process.env["PAYMENT_ENABLED_CURRENCIES"]?.trim();
  if (!raw) return [...PAYMENT_CURRENCIES];
  return parseEnabledCurrencies(raw.split(","), "PAYMENT_ENABLED_CURRENCIES");
}

/**
 * LamportPay's conversion fee in minor units for a deposit of `depositMinor`,
 * rounded UP to the smallest unit so the fee is never under-charged by rounding.
 */
export function conversionFeeMinor(depositMinor: bigint, feeBps: bigint): bigint {
  if (depositMinor < 0n) throw new Error("Deposit amount cannot be negative.");
  if (feeBps === 0n || depositMinor === 0n) return 0n;
  return (depositMinor * feeBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

/** What the user pays in total: Stables' exact deposit plus LamportPay's fee on top. */
export function totalToPayMinor(
  depositMinor: bigint,
  feeBps: bigint,
): {
  depositMinor: bigint;
  feeMinor: bigint;
  totalMinor: bigint;
} {
  const feeMinor = conversionFeeMinor(depositMinor, feeBps);
  return { depositMinor, feeMinor, totalMinor: depositMinor + feeMinor };
}
