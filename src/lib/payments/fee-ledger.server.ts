/**
 * Fee ledger and pricing snapshot (revenue engine).
 *
 * When a transfer is created the price is fixed: `pricingSnapshot()` builds the
 * record the user agreed to, and `expectedFeeEntries()` the ledger rows for
 * LamportPay's one total fee and each partner (Stables) fee. When the funding
 * transaction is verified on-chain, `receivedFeeEntry()` records what the
 * revenue wallet actually received. Rows are append-only (enforced by the
 * database) and written idempotently (unique per payment, category, entry
 * type and component), so a retry never double-counts.
 *
 * Categories: `lamportpay_fee` (LamportPay's one 2% fee, all LamportPay revenue,
 * charged once per payment), `partner_fee` (Stables' own fees, as Stables quoted
 * them; separate from and never deducted from the 2%) and
 * `swap_fee` (a LamportPay fee inside a swap; none is charged today).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import type { PaymentRow } from "./ledger.server";
import type { StoredFees } from "./view";

export type FeeCategory = "lamportpay_fee" | "partner_fee" | "swap_fee";

export type FeeLedgerEntry = {
  payment_id: string;
  category: FeeCategory;
  entry_type: "expected" | "received";
  component: string;
  amount_minor: number;
  currency: string;
  bps: number | null;
  reference: string | null;
};

function partnerFees(row: Pick<PaymentRow, "fees">): StoredFees {
  const fees = row.fees;
  if (!fees || typeof fees !== "object" || Array.isArray(fees)) return {};
  return fees as unknown as StoredFees;
}

/** The complete price of a payment at transfer creation. Pure. */
export function pricingSnapshot(
  row: Pick<
    PaymentRow,
    | "quote_id"
    | "source_currency"
    | "source_amount_minor"
    | "destination_currency"
    | "destination_country"
    | "destination_amount_minor"
    | "exchange_rate"
    | "fees"
    | "platform_fee_bps"
    | "platform_fee_minor"
    | "platform_fee_wallet"
    | "platform_fee_min_minor"
    | "platform_fee_max_minor"
    | "platform_fee_rule"
  >,
  deposit: { amountMinor: bigint; currency: string } | null,
  capturedAt: string,
): Json {
  const feeMinor = BigInt(row.platform_fee_minor ?? 0);
  const depositMinor = deposit?.amountMinor ?? BigInt(row.source_amount_minor);
  return {
    captured_at: capturedAt,
    quote_id: row.quote_id,
    source: { currency: row.source_currency, amount_minor: String(row.source_amount_minor) },
    destination: {
      currency: row.destination_currency,
      country: row.destination_country,
      amount_minor:
        row.destination_amount_minor === null ? null : String(row.destination_amount_minor),
    },
    exchange_rate: row.exchange_rate,
    partner_fees: partnerFees(row) as unknown as Json,
    lamportpay_fee: {
      bps: row.platform_fee_bps ?? 0,
      // Fee model at quote time (C05): optional bounds and which rule applied.
      min_minor: row.platform_fee_min_minor === null ? null : String(row.platform_fee_min_minor),
      max_minor: row.platform_fee_max_minor === null ? null : String(row.platform_fee_max_minor),
      rule: row.platform_fee_rule ?? (feeMinor > 0n ? "percentage" : "none"),
      amount_minor: feeMinor.toString(),
      currency: deposit?.currency ?? row.source_currency,
      // Whether a revenue wallet was set; the address itself stays in the row.
      revenue_wallet_set: Boolean(row.platform_fee_wallet),
    },
    deposit_minor: depositMinor.toString(),
    total_minor: (depositMinor + feeMinor).toString(),
  };
}

/** Ledger rows fixed at transfer creation. Pure. */
export function expectedFeeEntries(
  row: Pick<
    PaymentRow,
    "id" | "quote_id" | "fees" | "platform_fee_bps" | "platform_fee_minor" | "source_currency"
  >,
  depositCurrency: string,
): FeeLedgerEntry[] {
  const entries: FeeLedgerEntry[] = [];
  const feeMinor = row.platform_fee_minor ?? 0;
  if (feeMinor > 0) {
    entries.push({
      payment_id: row.id,
      category: "lamportpay_fee",
      entry_type: "expected",
      component: "",
      amount_minor: feeMinor,
      currency: depositCurrency,
      bps: row.platform_fee_bps ?? null,
      reference: row.quote_id,
    });
  }
  for (const [kind, fee] of Object.entries(partnerFees(row))) {
    if (!fee || typeof fee.amount_minor !== "number" || fee.amount_minor < 0) continue;
    entries.push({
      payment_id: row.id,
      category: "partner_fee",
      entry_type: "expected",
      component: kind,
      amount_minor: fee.amount_minor,
      currency: fee.currency,
      bps: null,
      reference: row.quote_id,
    });
  }
  return entries;
}

/** The ledger row for what the revenue wallet received on-chain. Pure. */
export function receivedFeeEntry(
  paymentId: string,
  receivedMinor: bigint,
  currency: string,
  signature: string,
): FeeLedgerEntry {
  return {
    payment_id: paymentId,
    category: "lamportpay_fee",
    entry_type: "received",
    component: "",
    amount_minor: Number(receivedMinor),
    currency,
    bps: null,
    reference: signature,
  };
}

/**
 * Append ledger rows; duplicates (same payment, category, type, component) are
 * ignored. Never throws: a ledger failure is logged for reconciliation and
 * must not undo a payment step that already happened.
 */
export async function appendFeeLedger(entries: FeeLedgerEntry[]): Promise<void> {
  if (entries.length === 0) return;
  for (const entry of entries) {
    const { error } = await supabaseAdmin.from("payment_fee_ledger").upsert(entry, {
      onConflict: "payment_id,category,entry_type,component",
      ignoreDuplicates: true,
    });
    if (error) {
      console.error(
        `[fee-ledger] ${entry.payment_id} ${entry.category}/${entry.entry_type} not recorded:`,
        error.message,
      );
    }
  }
}
