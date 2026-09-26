/**
 * Per-payment limits, one pair per funding stablecoin, all configurable:
 *   PAYMENT_MIN_USDC / PAYMENT_MAX_USDC and PAYMENT_MIN_USDT / PAYMENT_MAX_USDT
 *   (defaults 100 and 1,000,000).
 * Read per call from process.env. The dev server loads .env / .env.local at
 * startup, so a changed file needs a restart; a deployment needs a redeploy.
 * Stables applies its own per-customer limits on top (by verification level),
 * at execution time.
 */
import { toMajor, toMinor } from "@/lib/money";
import type { PaymentCurrency } from "@/lib/tokens";

const DEFAULT_MIN = "100";
const DEFAULT_MAX = "1000000";

export type PaymentLimits = { minMinor: bigint; maxMinor: bigint; min: string; max: string };

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
  const maxMinor = readLimit(`PAYMENT_MAX_${code}`, DEFAULT_MAX, currency);
  if (minMinor > maxMinor) throw new Error(`PAYMENT_MIN_${code} is above PAYMENT_MAX_${code}.`);
  return { minMinor, maxMinor, min: toMajor(minMinor, currency), max: toMajor(maxMinor, currency) };
}

/** "1000000.5" → "1,000,000.5" (major-unit decimal strings, for messages). */
export function groupThousands(major: string): string {
  const [whole, fraction] = major.split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}
