/**
 * Countries offered in the /pay country picker (UI only; the payment engine
 * still lets the live Stables quote decide every payout).
 *
 * Source of the default list (owner, 3 Oct 2026): the "Select destination
 * currency" list in the Stables dashboard — exactly these 20 currencies, nothing
 * else: ARS, AUD, BRL, CNY, COP, GBP, GHS, INR, KES, MXN, NGN, PHP, RWF, TZS,
 * UGX, USD, XAF, XOF, ZAR, ZMW. XAF and XOF are regional currencies; the
 * dashboard shows them with the Cameroon and Côte d'Ivoire flags, so those are
 * the countries offered (other XAF/XOF countries: OPEN with Stables).
 * Previous list (sandbox quotes, 30 Sep): NG, PH, MX, CO, BR, KE, GB, US, ZA,
 * GH, IN — all still included. Pakistan is not in Stables' list (OPEN, C36).
 *
 * A listed currency is not a guarantee for every amount: the live Stables
 * quote still decides each payout (on 1 Oct the sandbox refused 10 USDC to
 * IN/US/PH). Set PAYOUT_COUNTRIES (comma-separated ISO codes) on the server to
 * override — no code change needed. The payout currency comes from the country.
 */
import { payoutCurrencyFor } from "@/lib/country-currency";

/** Stables dashboard destination currencies, in its order (by currency code). */
export const DEFAULT_PAYOUT_COUNTRIES = [
  "AR", // ARS
  "AU", // AUD
  "BR", // BRL
  // CN / CNY removed 3 Oct: Stables requires trade documents + logistics tracking
  // for CNY bank payouts (validate endpoint), which a personal payout can't give.
  "CO", // COP
  "GB", // GBP
  "GH", // GHS
  "IN", // INR
  "KE", // KES
  "MX", // MXN
  "NG", // NGN
  "PH", // PHP
  "RW", // RWF
  "TZ", // TZS
  "UG", // UGX
  "US", // USD
  "CM", // XAF (Cameroon, as shown by Stables)
  "CI", // XOF (Côte d'Ivoire, as shown by Stables)
  "ZA", // ZAR
  "ZM", // ZMW
];

export type PayoutCountry = { code: string; currency: string };

/** Valid ISO codes with a known local currency, in the given order; unknown codes are dropped. */
export function payoutCountriesFrom(codes: readonly string[]): PayoutCountry[] {
  const seen = new Set<string>();
  const out: PayoutCountry[] = [];
  for (const raw of codes) {
    const code = raw.trim().toUpperCase();
    const currency = /^[A-Z]{2}$/.test(code) ? payoutCurrencyFor(code) : null;
    if (currency && !seen.has(code)) {
      seen.add(code);
      out.push({ code, currency });
    }
  }
  return out;
}

/** PAYOUT_COUNTRIES from the environment, or the evidence-based default. */
export function configuredPayoutCountries(raw: string | undefined): PayoutCountry[] {
  const list = raw?.trim() ? payoutCountriesFrom(raw.split(",")) : [];
  return list.length > 0 ? list : payoutCountriesFrom(DEFAULT_PAYOUT_COUNTRIES);
}
