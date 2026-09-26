/**
 * The payment shape returned to the browser. Minor units travel as strings
 * (JSON has no bigint); `amount` fields are major-unit strings for display.
 */
import { toMajor } from "@/lib/money";
import { isPaymentState, isTerminal, type PaymentState } from "./state";

export type FeeLine = { kind: string; amountMinor: string; amount: string; currency: string };

export type PaymentEventView = {
  at: string;
  kind: string;
  from: string | null;
  to: string | null;
  source: string;
};

export type PaymentView = {
  id: string;
  status: PaymentState;
  terminal: boolean;
  createdAt: string;
  source: { currency: string; network: string; amountMinor: string; amount: string };
  destination: {
    currency: string;
    country: string;
    amountMinor: string | null;
    amount: string | null;
  };
  exchangeRate: number | null;
  fees: FeeLine[];
  quote: { id: string; expiresAt: string | null } | null;
  transferId: string | null;
  deposit: {
    address: string;
    currency: string;
    network: string;
    amountMinor: string;
    amount: string;
  } | null;
  funding: { signature: string; payer: string | null; verifiedAt: string | null } | null;
  /** Wallet the USDC must come from (set when the funding transaction is prepared). */
  payerWallet: string | null;
  /** What Stables actually paid out, once the transfer completed. */
  actualPayout: { currency: string; amountMinor: string; amount: string } | null;
  beneficiary: unknown;
  purposeCode: string | null;
  failureReason: string | null;
  /** Stables is holding the transfer until the user proves they own the sending wallet. */
  travelRule: TravelRuleView | null;
  events: PaymentEventView[];
};

/**
 * required: the user must verify now. expired: the link lapsed before the hold
 * was lifted. resolved: the transfer moved on, so the hold was lifted.
 * closed: the payment ended (failed, cancelled, expired) with the hold open.
 */
export type TravelRuleStatus = "required" | "expired" | "resolved" | "closed";

export type TravelRuleView = {
  status: TravelRuleStatus;
  /** Only while the user can still act on it. */
  verificationUrl: string | null;
  expiresAt: string | null;
  requestedAt: string;
  resolvedAt: string | null;
};

type TravelRuleColumns = {
  status: string;
  travel_rule_verification_url: string | null;
  travel_rule_expires_at: string | null;
  travel_rule_requested_at: string | null;
  travel_rule_resolved_at: string | null;
};

export function travelRuleStatus(
  row: TravelRuleColumns,
  now: number = Date.now(),
): TravelRuleStatus | null {
  if (!row.travel_rule_requested_at) return null;
  if (row.travel_rule_resolved_at) return "resolved";
  if (isPaymentState(row.status) && isTerminal(row.status)) return "closed";
  const expires = row.travel_rule_expires_at ? Date.parse(row.travel_rule_expires_at) : NaN;
  return expires <= now ? "expired" : "required";
}

export function toTravelRuleView(
  row: TravelRuleColumns,
  now: number = Date.now(),
): TravelRuleView | null {
  const status = travelRuleStatus(row, now);
  if (!status) return null;
  return {
    status,
    verificationUrl: status === "required" ? row.travel_rule_verification_url : null,
    expiresAt: row.travel_rule_expires_at,
    requestedAt: row.travel_rule_requested_at!,
    resolvedAt: row.travel_rule_resolved_at,
  };
}

/** The signed-in user's Stables verification state. */
export type KycStatus = {
  status: "not_started" | "in_progress" | "approved" | "rejected" | "requires_action";
  basePayout: string | null;
  subStatus: string[];
  kycLink: string | null;
  kycLinkExpiresAt: string | null;
};

/** Fees as stored in `payments.fees`. */
export type StoredFees = Record<string, { amount_minor: number; currency: string }>;

type Row = {
  id: string;
  status: string;
  created_at: string;
  source_currency: string;
  source_network: string;
  source_amount_minor: number;
  destination_currency: string;
  destination_country: string;
  destination_amount_minor: number | null;
  exchange_rate: number | null;
  fees: unknown;
  quote_id: string | null;
  quote_expires_at: string | null;
  transfer_id: string | null;
  deposit_address: string | null;
  deposit_amount_minor: number | null;
  funding_signature: string | null;
  funding_payer: string | null;
  funding_verified_at: string | null;
  payer_wallet: string | null;
  actual_payout_minor: number | null;
  actual_payout_currency: string | null;
  beneficiary_summary: unknown;
  purpose_code: string | null;
  failure_reason: string | null;
} & TravelRuleColumns;

type EventRow = {
  created_at: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  source: string;
};

function amounts(minor: number | null, currency: string) {
  if (minor === null) return { amountMinor: null, amount: null };
  const value = BigInt(minor);
  return { amountMinor: value.toString(), amount: toMajor(value, currency) };
}

export function toPaymentView(row: Row, events: EventRow[] = []): PaymentView {
  const status = isPaymentState(row.status) ? row.status : "FAILED";
  const source = amounts(row.source_amount_minor, row.source_currency);
  const fees = (row.fees ?? {}) as StoredFees;

  return {
    id: row.id,
    status,
    terminal: isTerminal(status),
    createdAt: row.created_at,
    source: {
      currency: row.source_currency,
      network: row.source_network,
      amountMinor: source.amountMinor!,
      amount: source.amount!,
    },
    destination: {
      currency: row.destination_currency,
      country: row.destination_country,
      ...amounts(row.destination_amount_minor, row.destination_currency),
    },
    exchangeRate: row.exchange_rate === null ? null : Number(row.exchange_rate),
    fees: Object.entries(fees).map(([kind, fee]) => ({
      kind,
      currency: fee.currency,
      amountMinor: String(fee.amount_minor),
      amount: toMajor(BigInt(fee.amount_minor), fee.currency),
    })),
    quote: row.quote_id ? { id: row.quote_id, expiresAt: row.quote_expires_at } : null,
    transferId: row.transfer_id,
    deposit:
      row.deposit_address && row.deposit_amount_minor !== null
        ? {
            address: row.deposit_address,
            currency: row.source_currency,
            network: row.source_network,
            amountMinor: String(row.deposit_amount_minor),
            amount: toMajor(BigInt(row.deposit_amount_minor), row.source_currency),
          }
        : null,
    funding: row.funding_signature
      ? {
          signature: row.funding_signature,
          payer: row.funding_payer,
          verifiedAt: row.funding_verified_at,
        }
      : null,
    payerWallet: row.payer_wallet,
    actualPayout:
      row.actual_payout_minor !== null && row.actual_payout_currency
        ? {
            currency: row.actual_payout_currency,
            ...(amounts(row.actual_payout_minor, row.actual_payout_currency) as {
              amountMinor: string;
              amount: string;
            }),
          }
        : null,
    beneficiary: row.beneficiary_summary,
    purposeCode: row.purpose_code,
    failureReason: row.failure_reason,
    travelRule: toTravelRuleView(row),
    events: events.map((e) => ({
      at: e.created_at,
      kind: e.kind,
      from: e.from_status,
      to: e.to_status,
      source: e.source,
    })),
  };
}
