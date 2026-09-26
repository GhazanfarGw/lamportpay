/**
 * Money helpers. Internally every amount is an integer count of minor units
 * (bigint); partners like Stables speak decimal strings in major units
 * ("100.50"). Convert only at that boundary, never through floating point.
 */

/** Minor-unit exponents: stablecoins by token decimals, fiat by ISO 4217. */
const EXPONENTS: Record<string, number> = {
  usdc: 6,
  usdt: 6,
  aed: 2,
  ars: 2,
  aud: 2,
  bdt: 2,
  brl: 2,
  cad: 2,
  cny: 2,
  cop: 2,
  egp: 2,
  eur: 2,
  gbp: 2,
  ghs: 2,
  hkd: 2,
  idr: 2,
  inr: 2,
  kes: 2,
  mxn: 2,
  ngn: 2,
  pen: 2,
  php: 2,
  pkr: 2,
  rwf: 0,
  sgd: 2,
  thb: 2,
  tzs: 2,
  ugx: 0,
  usd: 2,
  vnd: 0,
  xaf: 0,
  xof: 0,
  zar: 2,
  zmw: 2,
};

export function currencyExponent(currency: string): number {
  const code = currency.toLowerCase();
  const exponent = EXPONENTS[code] ?? isoExponent(code);
  if (exponent === undefined) throw new Error(`Unknown currency: ${currency}`);
  return exponent;
}

let isoCurrencies: Set<string> | undefined;

/**
 * Minor-unit digits of an ISO 4217 currency not listed above, from the
 * runtime's CLDR data. Payout currencies are whatever Stables accepts, so this
 * table must not act as an allowlist.
 */
function isoExponent(code: string): number | undefined {
  isoCurrencies ??= new Set(Intl.supportedValuesOf("currency").map((c) => c.toLowerCase()));
  if (!isoCurrencies.has(code)) return undefined;
  return new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
    .maximumFractionDigits;
}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parse a major-unit decimal string into minor units.
 *
 * `strict` (default) rejects values more precise than the currency allows —
 * use it for amounts that must be exact, like a deposit the user has to send.
 * `round` rounds half-up instead — only for partner-reported display values
 * (fees, payout estimates) whose raw string is kept alongside.
 */
export function toMinor(
  value: string,
  currency: string,
  mode: "strict" | "round" = "strict",
): bigint {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new Error(`Invalid decimal amount: ${JSON.stringify(value)}`);
  const exponent = currencyExponent(currency);
  const whole = match[1]!;
  let fraction = match[2] ?? "";

  let roundUp = false;
  if (fraction.length > exponent) {
    const excess = fraction.slice(exponent);
    if (mode === "strict" && /[1-9]/.test(excess)) {
      throw new Error(`${value} has more than ${exponent} decimal places for ${currency}.`);
    }
    roundUp = mode === "round" && excess[0]! >= "5";
    fraction = fraction.slice(0, exponent);
  }

  const minor = BigInt(whole + fraction.padEnd(exponent, "0"));
  return roundUp ? minor + 1n : minor;
}

/** Format minor units as a major-unit decimal string, trimming trailing zeros. */
export function toMajor(minor: bigint, currency: string): string {
  if (minor < 0n) throw new Error("Negative amounts are not supported.");
  const exponent = currencyExponent(currency);
  if (exponent === 0) return minor.toString();
  const digits = minor.toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, -exponent);
  const fraction = digits.slice(-exponent).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Display format: grouped, at least 2 decimals (when the currency has them), never rounded. */
export function formatMinor(minor: bigint, currency: string): string {
  const [whole, fraction = ""] = toMajor(minor, currency).split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const shown = fraction.padEnd(Math.min(currencyExponent(currency), 2), "0");
  return shown ? `${grouped}.${shown}` : grouped;
}
