/**
 * Stables API shapes used by LamportPay (API v1, docs.stables.money).
 * Amounts are decimal strings in major units; convert with `@/lib/money`.
 */

export type StablesAmount = { amount: string; currency: string };

export type StablesFeeKind =
  "fx_fee" | "integrator_fee" | "platform_fee" | "payment_method_fee" | "network_fee" | "total_fee";

export type StablesFees = Partial<Record<StablesFeeKind, StablesAmount>>;

export type VerificationStatus = "in_progress" | "approved" | "rejected" | "requires_action";
export type EntitlementStatus = "submitted" | "in_progress" | "approved" | "rejected";

export interface StablesCustomer {
  customer_id: string;
  external_customer_id: string | null;
  customer_type: "individual" | "business";
  email: string;
  entitlements?: Array<{ name: string; status: EntitlementStatus }>;
  verification_levels: Array<{ level: string; status: VerificationStatus; sub_status?: string[] }>;
  status?: string;
  compliance_lock?: { lock_reason: string } | null;
}

export interface StablesCustomerList {
  customers: StablesCustomer[];
}

export interface StablesVerificationLink {
  customer_id: string;
  kyc_link: string;
}

export interface CreateVerificationLinkRequest {
  customer_type: "individual";
  external_customer_id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  entitlements: Array<"base_payout">;
  ttl_in_secs?: number;
  redirect?: { success_url?: string; reject_url?: string };
}

export interface CreateQuoteRequest {
  source: { currency: string; network: "solana"; amount: string };
  destination: { currency: string; country: string; network: "bank" };
  metadata?: Record<string, string>;
  /** Price the route without persisting a quote (support checks, estimates). */
  preview?: boolean;
}

export interface StablesQuote {
  quote_id: string;
  source: { currency: string; network?: string; amount: string };
  destination: { currency: string; network: string; amount: string };
  fees: StablesFees & { total_fee: StablesAmount };
  exchange_rate: number;
  expires_at: string;
  created_at: string;
  status: "active" | "expired" | "used" | "cancelled" | "preview";
}

export const PURPOSE_CODES = [
  "PERSONAL_REMITTANCE",
  "FAMILY_MAINTENANCE",
  "EDUCATION_EXPENSES",
  "MEDICAL_TREATMENT",
  "PAYMENT_FOR_SERVICES",
  "VENDOR_CONTRACTOR_PAYOUTS",
  "SALARY",
  "PAYMENT_OF_PROPERTY_RENTAL",
  "TRANSFER_TO_OWN_ACCOUNT",
  "DONATIONS",
] as const;

export type PurposeCode = (typeof PURPOSE_CODES)[number];

/**
 * Optional bank destination fields. Stables accepts all of them on every
 * currency and ignores the ones a destination does not need; which ones are
 * required is decided by Stables (see `validatePaymentMethod`).
 */
export const BANK_DETAIL_FIELDS = [
  "account_type",
  "branch_name",
  "swift_code",
  "bic_code",
  "ifsc_code",
  "aba_code",
  "sort_code",
  "branch_code",
  "bsb_code",
  "bank_code",
  "cnaps",
  "phone",
  "name_in_local_language",
  "national_identification_number",
] as const;

export type BankDetailField = (typeof BANK_DETAIL_FIELDS)[number];

export interface BankBeneficiary extends Partial<Record<BankDetailField, string>> {
  type: "bank";
  recipient_type: "individual" | "business";
  date_of_birth?: string;
  account_holder_name: string;
  account_number?: string;
  iban?: string;
  bank_name: string;
  bank_country: string;
  currency: string;
  address?: { street: string; city: string; state: string; postal_code: string; country: string };
}

export interface ValidatePaymentMethodRequest {
  network: "bank";
  destination: BankBeneficiary;
}

/** Always returned with 200; `errors` is present only when `valid` is false. */
export interface ValidatePaymentMethodResponse {
  valid: boolean;
  errors?: Array<{
    field?: string;
    message: string;
    code: "UNSUPPORTED_CURRENCY" | "UNSUPPORTED_PAYMENT_METHOD" | "INVALID_FIELDS" | string;
  }>;
}

export interface CreateTransferRequest {
  quote_id: string;
  customer_id: string;
  destination: BankBeneficiary;
  purpose_code: PurposeCode;
  metadata?: Record<string, string>;
}

export interface StablesTransfer {
  id: string;
  customer_id: string;
  quote_id: string;
  type: string;
  status: string;
  created_at: string;
  updated_at: string;
  source_deposit_instructions?: {
    wallet_address?: string;
    currency: string;
    network?: string;
    amount: string;
  } | null;
  destination?: { amount: string; currency: string; network: string } | null;
  fees?: StablesFees | null;
  exchange_rate?: number | null;
  /** Final settled amount, populated once the transfer completes. */
  actual_payout?: { amount: string; amount_minor?: number | string; currency: string } | null;
}

/**
 * Event types the dashboard endpoint is subscribed to. Anything else that
 * arrives is stored and acknowledged with 200, then ignored.
 */
export const SUBSCRIBED_WEBHOOK_EVENTS = [
  "customer.created",
  "customer.updated",
  "kyc_link.updated.status_transitioned",
  "transfer.updated.status_transitioned",
  "travel_rule.wallet_verification_required",
] as const;

/**
 * `event_object` of travel_rule.wallet_verification_required: a transaction is
 * held until the customer proves they own the self-custody wallet involved.
 * `event_object_id` repeats `transaction_reference_id`. Stables does not say
 * which of its IDs this reference is, so it is matched against the transfer ID
 * and the funding transaction signature.
 */
export interface TravelRuleVerificationRequired {
  transaction_reference_id: string;
  verification_url: string;
  expires_at: string;
}

/** Common envelope for every webhook delivery. */
export interface StablesWebhookEvent {
  api_version: string;
  event_id: string;
  event_developer_id?: string;
  event_category: string;
  event_type: string;
  event_object_id: string;
  event_object_status?: string;
  event_object: Record<string, unknown>;
  event_created_at: string;
}
