/**
 * Shared Payout partner API types for customer, external account, and transfer flows.
 * These are intentionally lightweight and match the Payout v0 API surface used
 * by LamportPay.
 */

export type PayoutCustomerType = "individual" | "business";

export interface PayoutCustomerRequest {
  type: PayoutCustomerType;
  first_name?: string;
  last_name?: string;
  email?: string;
  // Additional fields are omitted in the first demo integration.
}

export interface PayoutCustomerResponse {
  id: string;
  type: PayoutCustomerType;
  first_name?: string;
  last_name?: string;
  email?: string;
  status?: string;
}

export interface PayoutExternalAccountRequest {
  currency: string;
  // Supported rails: ach, iban, clabe, pix_key, pix_br_code, etc.
  // This is a simplified wrapper; real payloads differ per rail.
  account_number: string;
  routing_number?: string;
  bank_name?: string;
  account_holder_name?: string;
  account_holder_type?: "individual" | "business";
}

export interface PayoutExternalAccountResponse {
  id: string;
  currency: string;
  status?: string;
}

export interface PayoutTransferRequest {
  amount: string;
  on_behalf_of: string;
  source: {
    payment_rail: string;
    currency: string;
  };
  destination: {
    payment_rail: string;
    currency: string;
    external_account_id?: string;
    to_address?: string;
  };
  developer_fee?: string;
}

export interface PayoutTransferResponse {
  id: string;
  state: string;
  amount: string;
  source: Record<string, unknown>;
  destination: Record<string, unknown>;
  receipt?: {
    initial_amount: string;
    developer_fee: string;
    exchange_fee: string;
    final_amount: string;
    destination_tx_hash?: string | null;
  };
  source_deposit_instructions?: {
    amount: string;
    currency: string;
    deposit_address?: string;
  };
  created_at: string;
  updated_at: string;
}
