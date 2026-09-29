/**
 * Per-payment limits, one pair per funding stablecoin, all configurable:
 *   PAYMENT_MIN_USDC / PAYMENT_MAX_USDC and PAYMENT_MIN_USDT / PAYMENT_MAX_USDT
 *   (defaults 100 and 1,000,000). A maximum of "none" means LamportPay sets no
 *   maximum of its own and the payout partner's limits decide (owner decision,
 *   2026-09-29: "maximum as per Stables' limits").
 * Read per call from process.env. The dev server loads .env / .env.local at
 * startup, so a changed file needs a restart; a deployment needs a redeploy.
 * Stables applies its own per-customer limits on top (by verification level),
 * at execution time.
 */
import { toMajor, toMinor } from "@/lib/money";
import type { PaymentCurrency } from "@/lib/tokens";

const DEFAULT_MIN = "100";
const DEFAULT_MAX = "1000000";

export type PaymentLimits = {
  minMinor: bigint;
  /** Null: no LamportPay maximum; Stables' own limits apply. */
  maxMinor: bigint | null;
  min: string;
  max: string | null;
};

function readLimit(name: string, fallback: string, currency: PaymentCurrency): bigint {
  const raw = process.env[name]?.trim() || fallback;
  let value: bigint;
  try {
    value = toMinor(raw, currency);
  } catch {
    throw new Error(
      `${name} must be a ${currency.toUpperCase()} amount with at most 6 decimals, not ${JSON.stringify(raw)}.`,
    );
  }
  if (value <= 0n) throw new Error(`${name} must be greater than zero.`);
  return value;
}

/** Throws when the configuration is invalid (unparseable, or min above max). */
export function getPaymentLimits(currency: PaymentCurrency = "usdc"): PaymentLimits {
  const code = currency.toUpperCase();
  const minMinor = readLimit(`PAYMENT_MIN_${code}`, DEFAULT_MIN, currency);
  const noMax = process.env[`PAYMENT_MAX_${code}`]?.trim().toLowerCase() === "none";
  const maxMinor = noMax ? null : readLimit(`PAYMENT_MAX_${code}`, DEFAULT_MAX, currency);
  if (maxMinor !== null && minMinor > maxMinor) {
    throw new Error(`PAYMENT_MIN_${code} is above PAYMENT_MAX_${code}.`);
  }
  return {
    minMinor,
    maxMinor,
    min: toMajor(minMinor, currency),
    max: maxMinor === null ? null : toMajor(maxMinor, currency),
  };
}

/** Whether `amountMinor` is outside LamportPay's own limits. */
export function outsideLimits(amountMinor: bigint, limits: PaymentLimits): boolean {
  return amountMinor < limits.minMinor || (limits.maxMinor !== null && amountMinor > limits.maxMinor);
}

/** "Payments must be between 100 and 1,000,000 USDC." or "... at least 100 USDC." */
export function limitsMessage(limits: PaymentLimits, coinLabel: string): string {
  return limits.max === null
    ? `Payments must be at least ${groupThousands(limits.min)} ${coinLabel}.`
    : `Payments must be between ${groupThousands(limits.min)} and ${groupThousands(limits.max)} ${coinLabel}.`;
}

/** "1000000.5" → "1,000,000.5" (major-unit decimal strings, for messages). */
export function groupThousands(major: string): string {
  const [whole, fraction] = major.split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}
