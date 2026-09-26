/**
 * Per-payment limits in USDC while piloting. Both are configurable:
 *   PAYMENT_MIN_USDC (default 50) and PAYMENT_MAX_USDC (default 100).
 * Read per call so env changes apply without a restart.
 */
import { toMajor, toMinor } from "@/lib/money";

const DEFAULT_MIN_USDC = "50";
const DEFAULT_MAX_USDC = "100";

export type PaymentLimits = { minMinor: bigint; maxMinor: bigint; min: string; max: string };

function readLimit(name: string, fallback: string): bigint {
  const raw = process.env[name]?.trim() || fallback;
  let value: bigint;
  try {
    value = toMinor(raw, "usdc");
  } catch {
    throw new Error(
      `${name} must be a USDC amount with at most 6 decimals, not ${JSON.stringify(raw)}.`,
    );
  }
  if (value <= 0n) throw new Error(`${name} must be greater than zero.`);
  return value;
}

/** Throws when the configuration is invalid (unparseable, or min above max). */
export function getPaymentLimits(): PaymentLimits {
  const minMinor = readLimit("PAYMENT_MIN_USDC", DEFAULT_MIN_USDC);
  const maxMinor = readLimit("PAYMENT_MAX_USDC", DEFAULT_MAX_USDC);
  if (minMinor > maxMinor) throw new Error("PAYMENT_MIN_USDC is above PAYMENT_MAX_USDC.");
  return { minMinor, maxMinor, min: toMajor(minMinor, "usdc"), max: toMajor(maxMinor, "usdc") };
}
