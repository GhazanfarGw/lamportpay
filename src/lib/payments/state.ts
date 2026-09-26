/**
 * Payment state machine.
 *
 * LamportPay owns the states before a Stables transfer exists; from then on
 * the states are Stables' transfer states, driven by its webhooks. Every
 * transition is forward-only, following Stables' rules:
 *  - transfers never move backwards;
 *  - COMPLIANCE_HOLD can be entered from any non-terminal transfer state and
 *    resumes at the same state or later;
 *  - CANCELLED / EXPIRED only happen before funds are collected;
 *  - COMPLETED, FAILED, CANCELLED, EXPIRED are terminal.
 *
 * Keep in sync with the `payments.status` check constraint in the migration.
 */

export const PRE_TRANSFER_STATES = [
  "PAYMENT_CREATED",
  "KYC_PENDING",
  "KYC_APPROVED",
  "QUOTED",
  "KYC_REJECTED",
] as const;

export const TRANSFER_STATES = [
  "CREATED",
  "COMPLIANCE_HOLD",
  "AWAITING_FUNDS_COLLECTION",
  "FUNDS_COLLECTED",
  "IN_PROGRESS",
  "PAYMENT_SUBMITTED",
  "PAYMENT_PROCESSED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type PreTransferState = (typeof PRE_TRANSFER_STATES)[number];
export type TransferState = (typeof TRANSFER_STATES)[number];
export type PaymentState = PreTransferState | TransferState;

export const PAYMENT_STATES: readonly PaymentState[] = [...PRE_TRANSFER_STATES, ...TRANSFER_STATES];

export const TERMINAL_STATES: ReadonlySet<PaymentState> = new Set([
  "KYC_REJECTED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);

/** Transfer states Stables can still move forward; reconciliation polls these. */
export const ACTIVE_TRANSFER_STATES: readonly TransferState[] = TRANSFER_STATES.filter(
  (s) => !TERMINAL_STATES.has(s),
);

/** Position on the happy path. Exception states have no rank. */
const RANK: Partial<Record<PaymentState, number>> = {
  PAYMENT_CREATED: 0,
  KYC_PENDING: 1,
  KYC_APPROVED: 2,
  QUOTED: 3,
  CREATED: 4,
  AWAITING_FUNDS_COLLECTION: 5,
  FUNDS_COLLECTED: 6,
  IN_PROGRESS: 7,
  PAYMENT_SUBMITTED: 8,
  PAYMENT_PROCESSED: 9,
  COMPLETED: 10,
};

const FUNDS_COLLECTED_RANK = RANK.FUNDS_COLLECTED!;

export function isPaymentState(value: unknown): value is PaymentState {
  return typeof value === "string" && (PAYMENT_STATES as readonly string[]).includes(value);
}

export function isTransferState(state: PaymentState): state is TransferState {
  return (TRANSFER_STATES as readonly string[]).includes(state);
}

export function isTerminal(state: PaymentState): boolean {
  return TERMINAL_STATES.has(state);
}

export type TransitionCheck =
  { ok: true; preHold: TransferState | null } | { ok: false; reason: string };

/**
 * Decide whether `from → to` is allowed. `preHold` is the state a payment was
 * in when it entered COMPLIANCE_HOLD (null otherwise); the result carries the
 * value to store after the transition.
 */
export function checkTransition(
  from: PaymentState,
  to: PaymentState,
  preHold: TransferState | null = null,
): TransitionCheck {
  const deny = (reason: string): TransitionCheck => ({ ok: false, reason });
  const allow = (hold: TransferState | null = null): TransitionCheck => ({
    ok: true,
    preHold: hold,
  });

  if (from === to) return deny(`Already ${from}.`);
  if (isTerminal(from)) return deny(`${from} is terminal.`);

  if (!isTransferState(from)) {
    switch (to) {
      case "KYC_PENDING":
        return from === "PAYMENT_CREATED"
          ? allow()
          : deny(`KYC_PENDING must follow PAYMENT_CREATED.`);
      case "KYC_APPROVED":
        return from === "PAYMENT_CREATED" || from === "KYC_PENDING"
          ? allow()
          : deny(`${from} cannot move to KYC_APPROVED.`);
      case "KYC_REJECTED":
        return from === "PAYMENT_CREATED" || from === "KYC_PENDING"
          ? allow()
          : deny(`KYC can only be rejected before approval.`);
      case "QUOTED":
        return from === "KYC_APPROVED" ? allow() : deny(`A quote needs an approved customer.`);
      case "CANCELLED":
        return allow();
      default:
        break;
    }
    if (!isTransferState(to)) return deny(`${from} cannot move to ${to}.`);
    // A transfer exists only once a quote was accepted. The first state we
    // learn about may already be past CREATED if a webhook beat our response.
    if (from !== "QUOTED") return deny(`A transfer can only start from QUOTED.`);
    return to === "COMPLIANCE_HOLD" ? allow("CREATED") : allow();
  }

  // Both states are Stables transfer states from here on.
  const floor = from === "COMPLIANCE_HOLD" ? (preHold ?? "CREATED") : from;
  const floorRank = RANK[floor]!;

  switch (to) {
    case "COMPLIANCE_HOLD":
      return allow(from as TransferState);
    case "FAILED":
      return allow();
    case "CANCELLED":
      // A hold that does not pass review may cancel the transfer regardless.
      if (from === "COMPLIANCE_HOLD" || floorRank < FUNDS_COLLECTED_RANK) return allow();
      return deny(`CANCELLED is only possible before funds are collected.`);
    case "EXPIRED":
      return floorRank < FUNDS_COLLECTED_RANK
        ? allow()
        : deny(`EXPIRED is only possible before funds are collected.`);
    default: {
      const toRank = RANK[to];
      if (toRank === undefined || toRank < RANK.CREATED!)
        return deny(`${from} cannot move to ${to}.`);
      if (from === "COMPLIANCE_HOLD") {
        return toRank >= floorRank
          ? allow()
          : deny(`Cannot resume at ${to}; hold began at ${floor}.`);
      }
      return toRank > floorRank ? allow() : deny(`${to} would move backwards from ${from}.`);
    }
  }
}

/**
 * Whether reaching `state` after a Travel Rule wallet-verification request
 * means the hold was lifted. Stables sends no "verified" event, so the
 * transfer moving on is the signal: any later transfer state except another
 * hold, and except failing outright (the requirement then stays unresolved,
 * which admins need to see).
 */
export function liftsTravelRuleHold(state: PaymentState): boolean {
  if (!isTransferState(state) || state === "COMPLIANCE_HOLD") return false;
  return state === "COMPLETED" || !isTerminal(state);
}

/**
 * Normalize a Stables transfer status. REST responses use lowercase display
 * values ("awaiting_funds_collection"), webhooks use upper case, and legacy
 * payment resources use a PAYMENT_STATUS_ prefix. Returns null for statuses
 * that carry no state information (UNKNOWN, PAYMENT_STATUS_PENDING).
 */
export function normalizeTransferStatus(raw: unknown): TransferState | null {
  if (typeof raw !== "string") return null;
  const upper = raw
    .trim()
    .toUpperCase()
    .replace(/^(TRANSFER_STATUS_|PAYMENT_STATUS_)/, "");
  return (TRANSFER_STATES as readonly string[]).includes(upper) ? (upper as TransferState) : null;
}
