/**
 * Operations alerts: what about a payment needs a person to look at it.
 *
 * Pure (no I/O) so the admin list, the payment page and tests share one rule.
 * Nothing here changes a payment: statuses keep mirroring Stables. An alert
 * only tells the operations team where to look and what to do next.
 */
import { stuckSignal, STUCK_AFTER_MS } from "./stuck";

export type AttentionSeverity = "info" | "warning" | "critical";

export type AttentionCode =
  | "deposit_mismatch"
  | "ended_after_funds"
  | "compliance_hold"
  | "stables_slow"
  | "stables_very_slow"
  | "deposit_not_received"
  | "quote_abandoned"
  | "webhook_error"
  | "case_open";

export type AttentionSignal = {
  code: AttentionCode;
  severity: AttentionSeverity;
  label: string;
  /** What the operations team should do next. */
  action: string;
};

/** Thresholds, in one place so they can be reviewed and changed together. */
export const ATTENTION_AFTER_MS = {
  /** Waiting on Stables after the deposit: warning (same as the stuck rule). */
  stablesWarning: STUCK_AFTER_MS.stables,
  /**
   * Waiting on Stables: needs action. Stables says local rails pay out the same
   * day (T+0) and SWIFT within T+3 (questions #10, #50); a day without any status
   * change is past the local-rail promise.
   */
  stablesCritical: 24 * 60 * 60 * 1000,
  /** A quote nobody turned into a transfer. Informational only. */
  quoteAbandoned: 60 * 60 * 1000,
} as const;

/** States in which funds may have left the user's wallet and reached Stables. */
const FUNDS_STATES = new Set([
  "FUNDS_COLLECTED",
  "IN_PROGRESS",
  "PAYMENT_SUBMITTED",
  "PAYMENT_PROCESSED",
  "COMPLETED",
]);
const ENDED_WITHOUT_PAYOUT = new Set(["FAILED", "CANCELLED", "EXPIRED"]);

export type AttentionInput = {
  status: string;
  created_at: string;
  status_changed_at?: string | null;
  quote_expires_at?: string | null;
  transfer_id?: string | null;
  funding_signature?: string | null;
  funding_verified_at?: string | null;
  /** A deposit was rejected although funds reached the deposit address. */
  depositMismatch?: boolean;
  /** The payment reached a funds state at some point (from its events). */
  everCollectedFunds?: boolean;
  /** A stored Stables webhook for this payment failed to apply. */
  webhookError?: boolean;
  /** An operations case is open for this payment. */
  openCase?: boolean;
};

const SEVERITY_ORDER: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Every alert for a payment, most severe first. Empty when nothing needs a person. */
export function attentionSignals(row: AttentionInput, now: number = Date.now()): AttentionSignal[] {
  const out: AttentionSignal[] = [];
  const fundsReached =
    Boolean(row.funding_signature || row.funding_verified_at) ||
    Boolean(row.everCollectedFunds) ||
    FUNDS_STATES.has(row.status);

  if (row.depositMismatch && !row.funding_signature) {
    out.push({
      code: "deposit_mismatch",
      severity: "critical",
      label: "Wrong deposit amount reached Stables",
      action:
        "Open a case. Ask Stables operations how the received funds will be returned; do not ask the user to send again.",
    });
  }

  if (ENDED_WITHOUT_PAYOUT.has(row.status) && fundsReached) {
    out.push({
      code: "ended_after_funds",
      severity: "critical",
      label: `${row.status.toLowerCase()} after funds reached Stables`,
      action:
        "Open a refund case. Stables returns funds manually (answers #1, #19); confirm the amount and destination with them.",
    });
  }

  if (row.status === "COMPLIANCE_HOLD") {
    out.push({
      code: "compliance_hold",
      severity: "warning",
      label: "Compliance review at Stables",
      action:
        "Usually an RFI from Stables' banking partner (answer #12). Check with Stables what information they need.",
    });
  }

  const stuck = stuckSignal(row, now);
  if (stuck?.waitingOn === "stables") {
    const critical = stuck.sinceMs >= ATTENTION_AFTER_MS.stablesCritical;
    out.push({
      code: critical ? "stables_very_slow" : "stables_slow",
      severity: critical ? "critical" : "warning",
      label: stuck.label,
      action: critical
        ? "Use Recheck Stables; if Stables still reports no progress, raise the transfer ID with Stables."
        : "Use Recheck Stables. Statuses only change when Stables reports them.",
    });
  } else if (stuck?.waitingOn === "user") {
    out.push({
      code: "deposit_not_received",
      severity: "info",
      label: stuck.label,
      action: "No action unless the user reports a deposit; then check the transaction hash.",
    });
  }

  if (row.status === "QUOTED" && !row.transfer_id && row.quote_expires_at) {
    const expired = Date.parse(row.quote_expires_at);
    if (Number.isFinite(expired) && now - expired >= ATTENTION_AFTER_MS.quoteAbandoned) {
      out.push({
        code: "quote_abandoned",
        severity: "info",
        label: "Quote expired, never paid",
        action: "None. The user must get a new quote to continue.",
      });
    }
  }

  if (row.webhookError) {
    out.push({
      code: "webhook_error",
      severity: "warning",
      label: "A Stables webhook failed to apply",
      action:
        "Retried automatically by reconciliation. If it persists, compare our status with Stables (Recheck Stables).",
    });
  }

  if (row.openCase) {
    out.push({
      code: "case_open",
      severity: "warning",
      label: "Operations case open",
      action: "Follow the case on the payment page.",
    });
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** The highest severity among the signals, or null. */
export function topSeverity(signals: AttentionSignal[]): AttentionSeverity | null {
  return signals[0]?.severity ?? null;
}

/** Whether the payment reached a funds state, given its status history. */
export function reachedFunds(statuses: Iterable<string | null>): boolean {
  for (const s of statuses) if (s && FUNDS_STATES.has(s)) return true;
  return false;
}
