/**
 * Monitoring: where a payment is waiting, and whether it has waited too long.
 * Pure (no I/O) so the admin list and tests share one rule. Statuses are
 * LamportPay's mirror of Stables' transfer states; nothing here changes them.
 */

/** Waiting for the user (deposit not seen yet). */
const WAITING_FOR_USER = new Set(["CREATED", "AWAITING_FUNDS_COLLECTION"]);
/** Waiting for Stables after the deposit (conversion / payout). */
const WAITING_FOR_STABLES = new Set([
  "FUNDS_COLLECTED",
  "IN_PROGRESS",
  "PAYMENT_SUBMITTED",
  "PAYMENT_PROCESSED",
  "COMPLIANCE_HOLD",
]);

export const STUCK_AFTER_MS = {
  /** No status change from Stables for this long after the deposit. */
  stables: 2 * 60 * 60 * 1000,
  /** A transfer nobody funded. */
  user: 24 * 60 * 60 * 1000,
} as const;

export type StuckSignal = {
  waitingOn: "stables" | "user";
  sinceMs: number;
  label: string;
};

/**
 * `lastChangeAt`: when the payment last changed status (falls back to creation).
 * Returns null while the payment is moving normally or is finished.
 */
export function stuckSignal(
  row: { status: string; created_at: string; status_changed_at?: string | null },
  now: number = Date.now(),
): StuckSignal | null {
  const since = Date.parse(row.status_changed_at ?? row.created_at);
  if (!Number.isFinite(since)) return null;
  const waited = now - since;
  const hours = (ms: number) => Math.max(1, Math.floor(ms / 3_600_000));
  if (WAITING_FOR_STABLES.has(row.status) && waited >= STUCK_AFTER_MS.stables) {
    return {
      waitingOn: "stables",
      sinceMs: waited,
      label: `No update from Stables for ${hours(waited)}h (${row.status})`,
    };
  }
  if (WAITING_FOR_USER.has(row.status) && waited >= STUCK_AFTER_MS.user) {
    return {
      waitingOn: "user",
      sinceMs: waited,
      label: `Deposit not received for ${hours(waited)}h`,
    };
  }
  return null;
}
