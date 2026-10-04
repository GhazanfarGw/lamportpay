/**
 * The payment shape returned to the browser. Minor units travel as strings
 * (JSON has no bigint); `amount` fields are major-unit strings for display.
 */
import type { KycState } from "@/lib/identity/kyc-state";
import { toMajor } from "@/lib/money";
import { PAYMENT_CURRENCY_MINTS, SOL_MINT } from "@/lib/tokens";
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
  /**
   * LamportPay's own fee, added on top of what Stables receives and paid in the
   * same transaction. Null when the payment carries none. The revenue wallet is
   * deliberately not part of the view.
   */
  platformFee: {
    bps: number;
    /** Which part of the fee model decided the amount: percentage, minimum or maximum. */
    rule: string;
    amountMinor: string;
    amount: string;
    currency: string;
    /**
     * Whether the fee reached LamportPay in the verified funding transaction:
     * null until funding is verified. The destination is never exposed.
     */
    settled: boolean | null;
  } | null;
  /** What leaves the wallet in total: the Stables amount plus LamportPay's fee. */
  totalToPay: { amountMinor: string; amount: string; currency: string };
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
  /** Wallet the stablecoin must come from (set when the funding transaction is prepared). */
  payerWallet: string | null;
  /** What Stables actually paid out, once the transfer completed. */
  actualPayout: { currency: string; amountMinor: string; amount: string } | null;
  /** The user's own bank account, as stored: holder name, bank, masked number. */
  beneficiary: BeneficiarySummary | null;
  purposeCode: string | null;
  failureReason: string | null;
  /** Stables is holding the transfer until the user proves they own the sending wallet. */
  travelRule: TravelRuleView | null;
  /** When the payment reached COMPLETED (receipt date). */
  completedAt: string | null;
  /**
   * The latest deposit we could not accept although funds reached the deposit
   * address (wrong amount, or right amount from another wallet): the user must
   * not send again. Null once a deposit is verified.
   */
  depositIssue: { received: string; expected: string; reason: string; at: string } | null;
  /** An admin simulated the deposit (sandbox), so there is no Solana transaction. */
  simulatedDeposit: boolean;
  /**
   * TEST MODE only: the user's real devnet "Pay Now" transaction (a signed memo
   * that moves no funds), verified on devnet before the sandbox deposit was
   * simulated. Null until detected.
   */
  testPayment: {
    signature: string;
    wallet: string;
    explorerUrl: string;
    detectedAt: string;
  } | null;
  /** The latest settlement check: which coin pays, and whether a swap is needed. */
  settlement: SettlementView | null;
  /** The most recent swap attempt, if any. */
  latestSwap: SwapView | null;
  /**
   * While the payout partner is converting and paying out: the usual time to
   * reach the bank, in minutes (configured estimate, not a promise). Null
   * otherwise. The actual step times are in `events`.
   */
  payoutEstimateMinutes: number | null;
  events: PaymentEventView[];
};

/** One coin's answer from Stables in a settlement check. */
export type SettlementCandidateView = {
  coin: string;
  verdict: string;
  /** Payout for this coin, when Stables priced it. */
  destinationAmount: string | null;
  /** Why it can't be used, when it can't. */
  reason: string | null;
};

export type SettlementView = {
  /** funds_ready, swap_required, tentative, needs_sol, insufficient_funds. */
  kind: string;
  coin: string | null;
  /** One plain sentence for the user. */
  reason: string;
  checkedAt: string;
  wallet: string | null;
  preference: string;
  /** Real balances read for `wallet` (major units), or why they couldn't be read. */
  holdings:
    | { status: "ok"; sol: string; tokens: Record<string, string>; readAt: string | null }
    | { status: "unavailable"; reason: string }
    | null;
  candidates: SettlementCandidateView[];
  /** Missing amount of `coin` when a swap is needed or funds are short. */
  shortfall: string | null;
  swapInputs: Array<{ asset: string; available: string }>;
  solNeeded: string | null;
};

export type SwapView = {
  id: string;
  attempt: number;
  /** ordered, submitted, landed, failed, expired, abandoned. */
  status: string;
  inputAsset: string;
  outputAsset: string;
  inAmount: string;
  minOut: string;
  actualOut: string | null;
  signature: string | null;
  failureReason: string | null;
  createdAt: string;
};

/** `payments.beneficiary_summary`: never the full account number. */
export type BeneficiarySummary = {
  recipient_type: string;
  /** Payouts go to the user's own account only (set on payments since this rule). */
  own_account?: boolean;
  account_holder_name: string;
  bank_name: string;
  bank_country: string;
  account_kind?: "iban" | "account_number";
  /** Masked: "••••1234". */
  account: string | null;
};

/** One row of the payment history. */
export type PaymentListItem = {
  id: string;
  status: PaymentState;
  terminal: boolean;
  createdAt: string;
  source: { currency: string; amount: string };
  destination: { currency: string; country: string; amount: string | null };
  actualPayout: { currency: string; amount: string } | null;
  accountHolder: string | null;
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
  /**
   * Name on the approved Stables customer record: the only account holder name
   * payouts can use (own account only). Null until approved, or if Stables
   * holds no name.
   */
  verifiedName: string | null;
  /** Derived customer state (lib/identity/kyc-state): never from a wallet alone. */
  state: KycState;
  /** When Stables first approved verification and payouts, as we recorded it. */
  verifiedAt: string | null;
  /**
   * True when Stables could not be reached for a fresh status; the stored
   * status is shown instead and is never upgraded to verified by this.
   */
  providerUnavailable: boolean;
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
  /** LamportPay's fee snapshot (absent on older rows). */
  platform_fee_bps?: number | null;
  platform_fee_minor?: number | null;
  platform_fee_received_minor?: number | null;
  platform_fee_rule?: string | null;
  quote_id: string | null;
  quote_expires_at: string | null;
  transfer_id: string | null;
  deposit_address: string | null;
  deposit_amount_minor: number | null;
  /** Stables' own coin and network for the deposit (absent on older rows). */
  deposit_currency?: string | null;
  deposit_network?: string | null;
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
  /** Used to derive fields below; never sent to the browser as is. */
  detail?: unknown;
};

/**
 * When the payment completed: Stables' own time for the transfer reaching
 * COMPLETED (`detail.stables_at`, recorded by webhooks and reconciliation),
 * else when we recorded it. Reconciliation can notice hours later.
 */
function completedAtOf(events: EventRow[]): string | null {
  const completed = [...events]
    .reverse()
    .find((e) => e.kind === "transition" && e.to_status === "COMPLETED");
  if (!completed) return null;
  const stablesAt = (completed.detail as { stables_at?: unknown } | null)?.stables_at;
  return typeof stablesAt === "string" && Number.isFinite(Date.parse(stablesAt))
    ? stablesAt
    : completed.created_at;
}

const MINT_ASSETS: Record<string, string> = {
  [SOL_MINT]: "sol",
  ...Object.fromEntries(Object.entries(PAYMENT_CURRENCY_MINTS).map(([coin, mint]) => [mint, coin])),
};

/** Minor-unit string as a major amount of `asset` ("" when unreadable). */
function major(minor: unknown, asset: string): string {
  if (typeof minor !== "string" && typeof minor !== "number") return "";
  const text = String(minor);
  if (!/^\d+$/.test(text)) return "";
  try {
    return toMajor(BigInt(text), asset);
  } catch {
    return "";
  }
}

/** A `payment_swaps` row, as far as the browser needs it. */
type SwapRowLike = {
  id: string;
  attempt: number;
  status: string;
  input_mint: string;
  output_mint: string;
  in_amount_minor: number;
  min_out_minor: number;
  actual_out_minor: number | null;
  signature: string | null;
  failure_reason: string | null;
  created_at: string;
};

export function toSwapView(row: SwapRowLike): SwapView {
  const input = MINT_ASSETS[row.input_mint] ?? "unknown";
  const output = MINT_ASSETS[row.output_mint] ?? "unknown";
  return {
    id: row.id,
    attempt: row.attempt,
    status: row.status,
    inputAsset: input,
    outputAsset: output,
    inAmount: major(row.in_amount_minor, input === "unknown" ? "usdc" : input),
    minOut: major(row.min_out_minor, output === "unknown" ? "usdc" : output),
    actualOut:
      row.actual_out_minor === null
        ? null
        : major(row.actual_out_minor, output === "unknown" ? "usdc" : output),
    signature: row.signature,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}

const SETTLEMENT_EVENTS = new Set(["settlement_selected", "settlement_changed"]);

/** The latest settlement check, from the detail `settlement.server.ts` records. */
function settlementOf(events: EventRow[], payoutCurrency: string): SettlementView | null {
  const last = [...events].reverse().find((e) => SETTLEMENT_EVENTS.has(e.kind));
  const d = (last?.detail ?? null) as Record<string, unknown> | null;
  if (!last || !d) return null;
  const coin = typeof d["coin"] === "string" ? d["coin"] : null;
  const asset = coin ?? "usdc";
  const h = d["holdings"] as Record<string, unknown> | null | undefined;
  const holdings: SettlementView["holdings"] = !h
    ? null
    : h["status"] === "ok"
      ? {
          status: "ok",
          sol: major(h["sol_lamports"], "sol"),
          tokens: Object.fromEntries(
            Object.entries((h["tokens"] ?? {}) as Record<string, unknown>).map(([c, v]) => [
              c,
              major(v, c),
            ]),
          ),
          readAt: typeof h["read_at"] === "string" ? h["read_at"] : null,
        }
      : { status: "unavailable", reason: typeof h["reason"] === "string" ? h["reason"] : "" };
  const candidates = Array.isArray(d["candidates"])
    ? (d["candidates"] as Array<Record<string, unknown>>).map((c) => ({
        coin: String(c["coin"] ?? ""),
        verdict: String(c["verdict"] ?? ""),
        destinationAmount:
          c["destination_amount_minor"] !== undefined
            ? major(c["destination_amount_minor"], payoutCurrency) || null
            : null,
        reason: typeof c["reason"] === "string" ? c["reason"] : null,
      }))
    : [];
  const inputs = Array.isArray(d["swap_inputs"])
    ? (d["swap_inputs"] as Array<Record<string, unknown>>).map((i) => ({
        asset: String(i["asset"] ?? ""),
        available: major(i["available_minor"], String(i["asset"] ?? "usdc")),
      }))
    : [];
  return {
    kind: typeof d["kind"] === "string" ? d["kind"] : "unknown",
    coin,
    reason: typeof d["reason"] === "string" ? d["reason"] : "",
    checkedAt: typeof d["checked_at"] === "string" ? d["checked_at"] : last.created_at,
    wallet: typeof d["wallet"] === "string" ? d["wallet"] : null,
    preference: typeof d["preference"] === "string" ? d["preference"] : "auto",
    holdings,
    candidates,
    shortfall: d["shortfall_minor"] !== undefined ? major(d["shortfall_minor"], asset) : null,
    swapInputs: inputs,
    solNeeded:
      d["sol_needed_lamports"] !== undefined ? major(d["sol_needed_lamports"], "sol") : null,
  };
}

function amounts(minor: number | null, currency: string) {
  if (minor === null) return { amountMinor: null, amount: null };
  const value = BigInt(minor);
  return { amountMinor: value.toString(), amount: toMajor(value, currency) };
}

function isBeneficiarySummary(value: unknown): value is BeneficiarySummary {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as BeneficiarySummary).account_holder_name === "string"
  );
}

/** The verified TEST MODE payment transaction, from its audit event. */
function testPaymentOf(events: EventRow[]): PaymentView["testPayment"] {
  const event = [...events].reverse().find((e) => e.kind === "test_payment_detected");
  const d = event?.detail as Record<string, unknown> | null | undefined;
  if (!event || !d || typeof d["signature"] !== "string" || typeof d["wallet"] !== "string") {
    return null;
  }
  const signature = d["signature"];
  return {
    signature,
    wallet: d["wallet"],
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    detectedAt: event.created_at,
  };
}

/** Latest rejected deposit that still moved funds, unless a later one was verified. */
function depositIssueOf(row: Row, events: EventRow[]): PaymentView["depositIssue"] {
  if (row.funding_signature) return null;
  for (const e of [...events].reverse()) {
    if (e.kind !== "funding_rejected") continue;
    const detail = (e.detail ?? {}) as Record<string, unknown>;
    const received = typeof detail["received_minor"] === "string" ? detail["received_minor"] : "0";
    if (!/^\d+$/.test(received) || BigInt(received) === 0n) continue;
    const expected =
      typeof detail["expected_minor"] === "string" && /^\d+$/.test(detail["expected_minor"])
        ? BigInt(detail["expected_minor"])
        : BigInt(row.deposit_amount_minor ?? 0);
    return {
      received: toMajor(BigInt(received), row.source_currency),
      expected: toMajor(expected, row.source_currency),
      reason: typeof detail["reason"] === "string" ? detail["reason"] : "",
      at: e.created_at,
    };
  }
  return null;
}

export function toPaymentListItem(row: Row): PaymentListItem {
  const status = isPaymentState(row.status) ? row.status : "FAILED";
  return {
    id: row.id,
    status,
    terminal: isTerminal(status),
    createdAt: row.created_at,
    source: {
      currency: row.source_currency,
      amount: toMajor(BigInt(row.source_amount_minor), row.source_currency),
    },
    destination: {
      currency: row.destination_currency,
      country: row.destination_country,
      amount: amounts(row.destination_amount_minor, row.destination_currency).amount,
    },
    actualPayout:
      row.actual_payout_minor !== null && row.actual_payout_currency
        ? {
            currency: row.actual_payout_currency,
            amount: toMajor(BigInt(row.actual_payout_minor), row.actual_payout_currency),
          }
        : null,
    accountHolder: isBeneficiarySummary(row.beneficiary_summary)
      ? row.beneficiary_summary.account_holder_name
      : null,
  };
}

export function toPaymentView(
  row: Row,
  events: EventRow[] = [],
  swaps: SwapRowLike[] = [],
): PaymentView {
  const status = isPaymentState(row.status) ? row.status : "FAILED";
  const source = amounts(row.source_amount_minor, row.source_currency);
  const fees = (row.fees ?? {}) as StoredFees;
  // Stables' deposit instructions decide the coin and network once a transfer exists.
  const depositCurrency = row.deposit_currency ?? row.source_currency;
  const latest = [...swaps].sort((a, b) => b.attempt - a.attempt)[0];
  // The fee is charged in the coin that pays (the deposit coin once known).
  const feeMinor = BigInt(row.platform_fee_minor ?? 0);
  const payMinor = BigInt(row.deposit_amount_minor ?? row.source_amount_minor) + feeMinor;

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
    platformFee:
      feeMinor > 0n
        ? {
            bps: row.platform_fee_bps ?? 0,
            rule: row.platform_fee_rule ?? "percentage",
            amountMinor: feeMinor.toString(),
            amount: toMajor(feeMinor, depositCurrency),
            currency: depositCurrency,
            settled: row.funding_verified_at
              ? BigInt(row.platform_fee_received_minor ?? 0) >= feeMinor
              : null,
          }
        : null,
    totalToPay: {
      amountMinor: payMinor.toString(),
      amount: toMajor(payMinor, depositCurrency),
      currency: depositCurrency,
    },
    quote: row.quote_id ? { id: row.quote_id, expiresAt: row.quote_expires_at } : null,
    transferId: row.transfer_id,
    deposit:
      row.deposit_address && row.deposit_amount_minor !== null
        ? {
            address: row.deposit_address,
            currency: depositCurrency,
            network: row.deposit_network ?? row.source_network,
            amountMinor: String(row.deposit_amount_minor),
            amount: toMajor(BigInt(row.deposit_amount_minor), depositCurrency),
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
    beneficiary: isBeneficiarySummary(row.beneficiary_summary) ? row.beneficiary_summary : null,
    purposeCode: row.purpose_code,
    failureReason: row.failure_reason,
    travelRule: toTravelRuleView(row),
    completedAt: completedAtOf(events),
    depositIssue: depositIssueOf(row, events),
    simulatedDeposit: events.some((e) => e.kind === "sandbox_deposit_simulated"),
    testPayment: testPaymentOf(events),
    settlement: settlementOf(events, row.destination_currency),
    latestSwap: latest ? toSwapView(latest) : null,
    payoutEstimateMinutes: null,
    events: events.map((e) => ({
      at: e.created_at,
      kind: e.kind,
      from: e.from_status,
      to: e.to_status,
      source: e.source,
    })),
  };
}
