/** Builders for Stables responses, Solana transactions and signed webhook deliveries. */
import { createHmac, randomBytes } from "node:crypto";

import { Keypair } from "@solana/web3.js";

import type { StablesCustomer, StablesQuote, StablesTransfer } from "@/lib/stables/types";
import type { TokenBalance, TxResult } from "@/lib/solana-usdc.server";
import { USDC_MINT } from "@/lib/tokens";

export const WEBHOOK_KEY = Buffer.from("fixture-webhook-signing-key!!!!!");
export const WEBHOOK_SECRET = `whsec_${WEBHOOK_KEY.toString("base64")}`;

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A random base58 string shaped like a Solana transaction signature. */
export function fakeSignature(): string {
  return [...randomBytes(88)].map((b) => BASE58[b % 58]).join("");
}

export function newWallet(): string {
  return Keypair.generate().publicKey.toBase58();
}

export function customer(
  id: string,
  status: "in_progress" | "approved" | "rejected",
  externalId: string | null = null,
): StablesCustomer {
  return {
    customer_id: id,
    external_customer_id: externalId,
    customer_type: "individual",
    email: "user@example.com",
    first_name: "Asha",
    last_name: "Rao",
    verification_levels: [{ level: "individual_base", status }],
    entitlements: [
      { name: "base_payout", status: status === "approved" ? "approved" : "submitted" },
    ],
  };
}

export function quote(
  amount: string,
  currency: string,
  destinationAmount: string,
  overrides: Partial<StablesQuote> = {},
): StablesQuote {
  return {
    quote_id: `quote_${randomBytes(4).toString("hex")}`,
    source: { currency: "USDC", network: "solana", amount },
    destination: { currency: currency.toUpperCase(), network: "bank", amount: destinationAmount },
    fees: { total_fee: { amount: "0.75", currency: "usd" } },
    exchange_rate: 83.1,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    created_at: new Date().toISOString(),
    status: "active",
    ...overrides,
  };
}

export function transfer(
  id: string,
  depositAddress: string,
  amount: string,
  status = "awaiting_funds_collection",
  overrides: Partial<StablesTransfer> = {},
): StablesTransfer {
  return {
    id,
    customer_id: "cus_1",
    quote_id: "quote_1",
    type: "offramp",
    status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source_deposit_instructions: {
      wallet_address: depositAddress,
      currency: "usdc",
      network: "solana",
      amount,
    },
    destination: {
      amount: "6232.50",
      currency: "inr",
      network: "bank",
      account_number: "123456789012",
      account_holder_name: "Asha Rao",
    } as StablesTransfer["destination"],
    fees: { total_fee: { amount: "0.75", currency: "usd" } },
    exchange_rate: 83.1,
    ...overrides,
  };
}

function balance(index: number, owner: string, amount: bigint, mint = USDC_MINT): TokenBalance {
  return {
    accountIndex: index,
    mint,
    owner,
    uiTokenAmount: { amount: amount.toString(), decimals: 6, uiAmount: null },
  };
}

/**
 * A finalized transaction moving `amount` base units of `mint` from `from`
 * to `to`, signed by `signer`.
 */
export function usdcTransferTx(options: {
  from: string;
  to: string;
  amount: bigint;
  signer?: string;
  mint?: string;
  err?: unknown;
  fromStart?: bigint;
  /** LamportPay's fee leg in the same transaction. */
  fee?: { to: string; amount: bigint };
}): NonNullable<TxResult> {
  const start = options.fromStart ?? 1_000_000_000n;
  const mint = options.mint ?? USDC_MINT;
  const feeAmount = options.fee?.amount ?? 0n;
  return {
    slot: 300_000_000,
    blockTime: Math.floor(Date.now() / 1000),
    meta: {
      err: options.err ?? null,
      fee: 5000,
      preBalances: [],
      postBalances: [],
      preTokenBalances: [balance(1, options.from, start, mint)],
      postTokenBalances: [
        balance(1, options.from, start - options.amount - feeAmount, mint),
        balance(2, options.to, options.amount, mint),
        ...(options.fee ? [balance(3, options.fee.to, options.fee.amount, mint)] : []),
      ],
    },
    transaction: {
      message: {
        accountKeys: [options.signer ?? options.from, "ataFrom", "ataTo"],
        header: { numRequiredSignatures: 1 },
      },
    },
  };
}

/** A webhook delivery signed like Stables' dashboard (Svix) endpoints sign it. */
export function signedWebhook(body: unknown, secretKey = WEBHOOK_KEY): Request {
  const raw = JSON.stringify(body);
  const id = `msg_${randomBytes(6).toString("hex")}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secretKey)
    .update(`${id}.${timestamp}.${raw}`)
    .digest("base64");
  return new Request("http://localhost/api/public/stables-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
    body: raw,
  });
}

let eventCounter = 0;

export function transferEvent(
  transferId: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  return {
    api_version: "v1",
    event_id: `evt_${++eventCounter}_${randomBytes(3).toString("hex")}`,
    event_category: "transfer",
    event_type: "transfer.updated.status_transitioned",
    event_object_id: transferId,
    event_object_status: status,
    event_object: { transfer_id: transferId, status, ...extra },
    event_created_at: new Date().toISOString(),
  };
}

/**
 * kyc_link.updated.status_transitioned. Real ones name the verification level
 * (`kyc_level`: INDIVIDUAL_BASE, or a step-up such as
 * INDIVIDUAL_PROOF_OF_ADDRESS) and use the KYC link as `event_object_id`.
 */
export function kycEvent(customerId: string, status: string, level?: string) {
  return {
    api_version: "v1",
    event_id: `evt_${++eventCounter}_${randomBytes(3).toString("hex")}`,
    event_category: "kyc_link",
    event_type: "kyc_link.updated.status_transitioned",
    event_object_id: customerId,
    event_object_status: status,
    event_object: { customer_id: customerId, status, ...(level && { kyc_level: level }) },
    event_created_at: new Date().toISOString(),
  };
}

/** customer.created / customer.updated, shaped like the Stables docs example. */
export function customerEvent(
  type: "customer.created" | "customer.updated",
  customerId: string,
  externalId: string | null = null,
) {
  return {
    api_version: "v1",
    event_id: `evt_${++eventCounter}_${randomBytes(3).toString("hex")}`,
    event_category: "customer",
    event_type: type,
    event_object_id: customerId,
    event_object: {
      customer_id: customerId,
      external_customer_id: externalId,
      customer_type: "CUSTOMER_TYPE_INDIVIDUAL",
      email: "user@example.com",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    event_created_at: new Date().toISOString(),
  };
}

/** travel_rule.wallet_verification_required, shaped like the Stables docs example. */
export function travelRuleEvent(
  reference: string,
  options: { url?: string; expiresAt?: string; createdAt?: string } = {},
) {
  return {
    api_version: "v1",
    event_id: `evt_${++eventCounter}_${randomBytes(3).toString("hex")}`,
    event_category: "travel_rule",
    event_type: "travel_rule.wallet_verification_required",
    event_object_id: reference,
    event_object: {
      transaction_reference_id: reference,
      verification_url:
        options.url ?? "https://verify.example.com/payment-sources/confirm?token=abc123",
      expires_at: options.expiresAt ?? new Date(Date.now() + 24 * 3600_000).toISOString(),
    },
    event_created_at: options.createdAt ?? new Date().toISOString(),
  };
}
