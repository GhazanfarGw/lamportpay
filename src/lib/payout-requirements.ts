/**
 * The bank fields each payout currency needs — and ONLY those, so the /pay bank
 * form asks for the minimum (owner request 3 Oct 2026: "keep it simple; collect
 * only what Stables needs").
 *
 * Source: Stables sandbox `/api/v1/payment-methods/validate`, 3 Oct 2026
 * (scripts/stables-bank-fields-probe.mjs). Round 1 sent only a bank name and an
 * account number and recorded what Stables asked for; round 2 sent exactly
 * those fields and Stables answered `valid: true` for every currency below.
 * Stables still validates every real submission, so a rule it changes later is
 * caught (and shown on the right field) before any transfer is created.
 *
 * CNY is not here: Stables also requires trade documents and logistics tracking
 * for CNY bank payouts, which a personal off-ramp cannot provide (OPEN).
 */
import type { BankDetailField } from "@/lib/stables/types";

/** Extra fields a currency needs besides the bank name and account. */
export type ExtraField =
  | "phone"
  | "national_identification_number"
  | "bsb_code"
  | "sort_code"
  | "ifsc_code"
  | "aba_code"
  | "swift_code"
  | "address";

export type PayoutForm = {
  /** What the account field is called locally, and its format (from Stables' messages). */
  account: { label: string; hint?: string; pattern?: string; inputMode?: "numeric" | "text" };
  extra: ExtraField[];
  /** Stables accepts only these bank names (PHP); otherwise free text. */
  bankNames?: readonly string[];
};

const PHONE_DEFAULT: PayoutForm = { account: { label: "Account number" }, extra: ["phone"] };

/** Banks Stables accepts for PHP payouts (verbatim from its validation answer, 3 Oct 2026). */
export const PHP_BANK_NAMES = [
  "AllBank Inc.",
  "Amanah Islamic Investment Bank",
  "Asia United Bank (AUB)",
  "Australia and New Zealand Bank",
  "Bank of China, Ltd. - Manila Branch",
  "Banco De Oro Unibank, Inc.",
  "Bangkok Bank Public Co, Ltd.",
  "Bangko Kabayan Inc",
  "Bangko Mabuhay (A Rural Bank), Inc.",
  "Bangko Nuestra Señora Del Pilar Inc",
  "Bank of America, N.A.",
  "Bank of Commerce",
  "Bank of Florida",
  "Bank of Makati",
  "Bank of the Philippine Islands (BPI)",
  "Binangonan Rural Bank (BRBDigital)",
  "Cantilan Bank",
  "Country Builders Bank Inc",
  "China Banking Corporation",
  "China Bank Savings",
  "Cebuana Lhuillier Rural Bank, Inc.",
  "CIMB Bank Philippines",
  "Citibank, N.A.",
  "Camalig Bank",
  "CARD Bank",
  "CARD SME Bank, Inc., A Thrift Bank",
  "CTBC Bank (Philippines) Corp.",
  "Deutsche Bank AG",
  "Dungganon Bank (A Microfinance Rural Bank), Inc.",
  "Development Bank of the Philippines",
  "Dumaguete City Development Bank",
  "Equicom Savings Bank, Inc.",
  "East West Banking Corporation",
  "EastWest Rural Bank",
  "First Consolidated Bank Inc",
  "GoTyme Bank",
  "Guagua Rural Bank Inc",
  "Hong Kong and Shanghai Banking Corp.",
  "HSBC Savings Bank Inc",
  "Innovative Rural Bank Inc",
  "Industrial Bank of Korea",
  "Industrial and Commercial Bank of China (ICBC) - Manila Branch",
  "ISLA Bank",
  "JP Morgan Chase Bank, NA.",
  "KEB Hana Bank - Manila Branch",
  "Land Bank of The Philippines",
  "Legazpi Savings Bank, Inc.",
  "Maya Bank, Inc.",
  "Mindanao Consolidated Cooperative Bank",
  "Mega International Commercial Bank Co, Ltd.",
  "Metropolitan Bank and Trust Company (Metrobank)",
  "Mizuho Bank, Ltd. - Manila Branch",
  "Maybank Philippines",
  "Malayan Bank Savings and Mortgage Bank, Inc.",
  "MUFG Bank, Ltd.",
  "Omnipay, Inc.",
  "BDO Network Bank",
  "Partner Rural Bank (Cotabato), Inc.",
  "Philippine Business Bank, Inc., A Savings Bank",
  "Philippine Bank of Communications (PBCOM)",
  "Philippine National Bank (PNB)",
  "Producers Bank",
  "Philippine Savings Bank (PSBank)",
  "Philippine Trust Company",
  "Philippine Veterans Bank",
  "Queen City Development Bank, Inc.",
  "Quezon Capital Rural Bank, Inc",
  "Rang-Ay Bank Inc",
  "Rural Bank of Digos",
  "Rural Bank of Guinobatan, Inc.",
  "Rural Bank of Montalban, Inc",
  "Rizal Commercial Banking Corporation (RCBC)",
  "Sterling Bank of Asia",
  "Standard Chartered Bank",
  "Seabank Philippines Inc.",
  "Security Bank Corporation",
  "Shinhan Bank - Manila Branch",
  "Sumitomo Mitsui Banking Corporation (SMBC)",
  "Sun Savings Bank",
  "Tonik Digital Bank, Inc.",
  "Tong Yang Savings Bank, Inc.",
  "Union Bank of the Philippines (UBP)",
  "Union Digital Bank",
  "UNObank, Inc",
  "United Overseas Bank, Ltd. (UOB) - Manila Branch",
  "Wealth Development Bank Corporation",
] as const;

export const PAYOUT_FORMS: Readonly<Record<string, PayoutForm>> = {
  ARS: {
    account: { label: "CBU / CVU", hint: "22 digits", pattern: "\\d{22}", inputMode: "numeric" },
    extra: ["phone", "national_identification_number"],
  },
  AUD: { account: { label: "Account number", inputMode: "numeric" }, extra: ["bsb_code"] },
  BRL: {
    account: { label: "PIX key", hint: "Your CPF, CNPJ or phone with +55" },
    extra: ["phone"],
  },
  COP: { account: { label: "Account number" }, extra: ["phone", "national_identification_number"] },
  GBP: {
    account: { label: "Account number", hint: "Usually 8 digits", inputMode: "numeric" },
    extra: ["sort_code", "address"],
  },
  GHS: PHONE_DEFAULT,
  INR: {
    account: {
      label: "Account number",
      hint: "9–18 digits",
      pattern: "\\d{9,18}",
      inputMode: "numeric",
    },
    extra: ["ifsc_code", "address"],
  },
  KES: PHONE_DEFAULT,
  MXN: {
    account: { label: "CLABE", hint: "18 digits", pattern: "\\d{18}", inputMode: "numeric" },
    extra: ["phone", "address"],
  },
  NGN: {
    account: {
      label: "Account number (NUBAN)",
      hint: "10 digits",
      pattern: "\\d{10}",
      inputMode: "numeric",
    },
    extra: ["phone"],
  },
  PHP: {
    account: {
      label: "Account number",
      hint: "10–16 digits",
      pattern: "\\d{10,16}",
      inputMode: "numeric",
    },
    extra: ["swift_code"],
    bankNames: PHP_BANK_NAMES,
  },
  RWF: PHONE_DEFAULT,
  TZS: PHONE_DEFAULT,
  UGX: PHONE_DEFAULT,
  USD: {
    account: { label: "Account number", inputMode: "numeric" },
    extra: ["aba_code", "address"],
  },
  XAF: PHONE_DEFAULT,
  XOF: PHONE_DEFAULT,
  ZAR: PHONE_DEFAULT,
  ZMW: PHONE_DEFAULT,
};

/** Labels, hints and formats for the extra fields (formats as Stables checks them). */
export const EXTRA_FIELD_UI: Record<
  Exclude<ExtraField, "address">,
  { label: string; hint?: string; pattern?: string; inputMode?: "numeric" | "text" | "tel" }
> = {
  phone: {
    label: "Your phone number",
    hint: "With country code, e.g. +234 801 234 5678",
    inputMode: "tel",
  },
  national_identification_number: { label: "Your national ID number" },
  bsb_code: { label: "BSB", hint: "6 digits", pattern: "\\d{3}-?\\d{3}", inputMode: "numeric" },
  sort_code: {
    label: "Sort code",
    hint: "6 digits",
    pattern: "\\d{2}-?\\d{2}-?\\d{2}",
    inputMode: "numeric",
  },
  ifsc_code: {
    label: "IFSC code",
    hint: "11 characters, e.g. HDFC0001234",
    pattern: "[A-Za-z]{4}0[A-Za-z0-9]{6}",
  },
  aba_code: {
    label: "Routing number (ABA)",
    hint: "9 digits",
    pattern: "\\d{9}",
    inputMode: "numeric",
  },
  swift_code: {
    label: "SWIFT / BIC",
    hint: "8 or 11 characters",
    pattern: "[A-Za-z0-9]{8}([A-Za-z0-9]{3})?",
  },
};

/** The form for a payout currency, or null when LamportPay cannot collect what it needs. */
export function payoutFormFor(currency: string): PayoutForm | null {
  return PAYOUT_FORMS[currency.toUpperCase()] ?? null;
}

/** Normalise what users type to what Stables expects (spaces/dashes out of codes). */
export function normalizeExtra(field: ExtraField, value: string): string {
  const v = value.trim();
  if (field === "phone") return v.replace(/[\s()-]/g, "");
  if (field === "bsb_code" || field === "sort_code" || field === "aba_code")
    return v.replace(/[\s-]/g, "");
  if (field === "ifsc_code" || field === "swift_code") return v.replace(/\s/g, "").toUpperCase();
  return v;
}

/** Extra fields that travel in Stables' `details` object (everything except the address). */
export function isBankDetailField(
  field: ExtraField,
): field is Exclude<ExtraField, "address"> & BankDetailField {
  return field !== "address";
}
