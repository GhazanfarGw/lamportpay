/**
 * Maps LamportPay demo corridors and payout methods to Payout payment rails.
 * These mappings are approximate and will need to be updated as Payout
 * expands corridor coverage.
 */

export const PAYOUT_PAYMENT_RAILS: Record<string, string> = {
  USD: "ach",
  EUR: "iban",
  GBP: "iban",
  MXN: "clabe",
  BRL: "pix_key",
  COP: "co_bank_transfer",
  INR: "iban", // Payout may support local rails; fallback to iban for demo.
  PHP: "iban", // Fallback for demo.
  NGN: "iban", // Fallback for demo.
  PKR: "iban", // Fallback for demo.
  BDT: "iban", // Fallback for demo.
  EGP: "iban", // Fallback for demo.
  PEN: "iban", // Fallback for demo.
  CAD: "ach",
  AUD: "ach",
  AED: "iban",
};

export const PAYOUT_RAIL_BY_METHOD: Record<string, string> = {
  "Bank account": "ach",
  "Mobile wallet": "mobile_wallet",
  Card: "card",
  "Cash pickup": "cash_pickup",
};

export function getPayoutPaymentRail(currency: string, method?: string): string {
  if (method && PAYOUT_RAIL_BY_METHOD[method]) {
    return PAYOUT_RAIL_BY_METHOD[method];
  }
  return PAYOUT_PAYMENT_RAILS[currency] || "ach";
}

export function payoutCurrency(currency: string): string {
  return currency.toLowerCase();
}
