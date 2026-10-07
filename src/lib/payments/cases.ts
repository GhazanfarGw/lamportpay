/**
 * Operations cases: the manual workflow for payments that need a person —
 * refunds and returns, wrong deposit amounts, returned payouts, compliance and
 * KYC problems, stuck payments.
 *
 * A case sits NEXT TO a payment. It never changes the payment's status, which
 * keeps mirroring Stables. LamportPay is non-custodial and never moves customer
 * funds: Stables returns funds manually with its operations team (answers #1,
 * #8, #19–22), and a case records that coordination.
 *
 * Keep in sync with the check constraints in 20261007100000_payment_cases.sql.
 */

export const CASE_KINDS = [
  "refund",
  "wrong_amount",
  "returned_payout",
  "compliance",
  "kyc",
  "stuck",
  "other",
] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const CASE_STATUSES = [
  "refund_required",
  "refund_requested",
  "waiting_for_stables",
  "refund_confirmed",
  "refund_failed",
  "customer_notified",
  "closed",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_KIND_LABELS: Record<CaseKind, string> = {
  refund: "Refund / return of funds",
  wrong_amount: "Wrong deposit amount",
  returned_payout: "Payout returned by the bank",
  compliance: "Compliance review",
  kyc: "KYC problem",
  stuck: "Payment stuck",
  other: "Other",
};

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  refund_required: "Refund required",
  refund_requested: "Refund requested from Stables",
  waiting_for_stables: "Waiting for Stables",
  refund_confirmed: "Refund confirmed",
  refund_failed: "Refund failed",
  customer_notified: "Customer notified",
  closed: "Closed",
};

/**
 * Allowed status moves. The workflow is: required → requested → waiting →
 * confirmed / failed → customer notified → closed. A failed refund can be
 * requested again. Any open case can be closed with a note (for example a
 * case that turned out to need no refund); a closed case stays closed.
 */
const NEXT: Record<CaseStatus, readonly CaseStatus[]> = {
  refund_required: ["refund_requested", "waiting_for_stables", "customer_notified", "closed"],
  refund_requested: ["waiting_for_stables", "refund_confirmed", "refund_failed", "closed"],
  waiting_for_stables: ["refund_confirmed", "refund_failed", "customer_notified", "closed"],
  refund_confirmed: ["customer_notified", "closed"],
  refund_failed: ["refund_requested", "waiting_for_stables", "customer_notified", "closed"],
  customer_notified: ["closed"],
  closed: [],
};

export function allowedNextStatuses(from: CaseStatus): readonly CaseStatus[] {
  return NEXT[from];
}

export function checkCaseTransition(
  from: CaseStatus,
  to: CaseStatus,
): { ok: true } | { ok: false; reason: string } {
  if (from === to) return { ok: false, reason: `The case is already ${CASE_STATUS_LABELS[to]}.` };
  if (NEXT[from].includes(to)) return { ok: true };
  return {
    ok: false,
    reason: `A case cannot move from "${CASE_STATUS_LABELS[from]}" to "${CASE_STATUS_LABELS[to]}".`,
  };
}

export function isCaseOpen(status: CaseStatus): boolean {
  return status !== "closed";
}

/** A Solana transaction signature (base58, 64 bytes → 86–88 chars). */
export function isSolanaSignature(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value);
}

/** A Solana address (base58, 32 bytes → 32–44 chars). */
export function isSolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

/** Facts a case can record. All optional; set as they become known. */
export type CaseFields = {
  stables_reference?: string | null;
  original_wallet?: string | null;
  original_amount_minor?: number | null;
  asset?: string | null;
  refund_amount_minor?: number | null;
  refund_destination?: string | null;
  stables_communication?: string | null;
  refund_tx_signature?: string | null;
};

/** Field checks shared by the server and the form. Returns an error message or null. */
export function validateCaseFields(fields: CaseFields): string | null {
  const amounts = [fields.original_amount_minor, fields.refund_amount_minor];
  for (const a of amounts) {
    if (a !== undefined && a !== null && (!Number.isSafeInteger(a) || a < 0)) {
      return "Amounts must be whole minor units, zero or more.";
    }
  }
  if (fields.refund_tx_signature && !isSolanaSignature(fields.refund_tx_signature)) {
    return "The refund transaction hash is not a Solana signature.";
  }
  if (fields.original_wallet && !isSolanaAddress(fields.original_wallet)) {
    return "The original wallet is not a Solana address.";
  }
  // The destination is free text: usually the sending wallet, but Stables decides
  // case by case (answer #21) and a fiat return is possible.
  if (fields.refund_destination && fields.refund_destination.length > 200) {
    return "The refund destination is too long.";
  }
  if (fields.asset && !/^(usdc|usdt)$/.test(fields.asset)) {
    return "The asset must be USDC or USDT.";
  }
  return null;
}
