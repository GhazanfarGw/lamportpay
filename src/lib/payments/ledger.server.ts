/**
 * Payment ledger persistence (record-keeping only). Status changes go through
 * `transitionPayment`, which enforces the state machine with optimistic
 * concurrency and appends every applied or rejected transition to
 * `payment_events`.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  ACTIVE_TRANSFER_STATES,
  checkTransition,
  isPaymentState,
  liftsTravelRuleHold,
  type PaymentState,
  type TransferState,
} from "./state";

type Tables = Database["public"]["Tables"];
export type PaymentRow = Tables["payments"]["Row"];
export type PaymentUpdate = Tables["payments"]["Update"];
export type StablesCustomerRow = Tables["stables_customers"]["Row"];
export type EventSource = "api" | "webhook" | "reconcile";

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505";

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
}

export function paymentState(row: PaymentRow): PaymentState {
  if (!isPaymentState(row.status))
    throw new Error(`Payment ${row.id} has unknown status ${row.status}.`);
  return row.status;
}

export async function getPayment(id: string): Promise<PaymentRow | null> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("Load payment", error);
  return data;
}

export async function getOwnedPayment(id: string, userId: string): Promise<PaymentRow | null> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("Load payment", error);
  return data;
}

export async function getPaymentByTransferId(transferId: string): Promise<PaymentRow | null> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("transfer_id", transferId)
    .maybeSingle();
  if (error) fail("Load payment by transfer", error);
  return data;
}

export async function getPaymentByFundingSignature(signature: string): Promise<PaymentRow | null> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("funding_signature", signature)
    .maybeSingle();
  if (error) fail("Load payment by funding signature", error);
  return data;
}

export async function listPaymentEvents(paymentId: string) {
  const { data, error } = await supabaseAdmin
    .from("payment_events")
    .select("created_at, kind, from_status, to_status, source, detail")
    .eq("payment_id", paymentId)
    .order("id", { ascending: true });
  if (error) fail("Load payment events", error);
  return data;
}

/** A user's payments, newest first. */
export async function listPaymentsForUser(userId: string, limit: number): Promise<PaymentRow[]> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail("Load payments", error);
  return data;
}

export async function insertPayment(row: Tables["payments"]["Insert"]): Promise<PaymentRow> {
  const { data, error } = await supabaseAdmin.from("payments").insert(row).select("*").single();
  if (error || !data) fail("Create payment", error);
  return data;
}

export async function recordEvent(
  paymentId: string,
  kind: string,
  source: EventSource,
  extra: { from?: string | null; to?: string | null; detail?: Json } = {},
) {
  const { error } = await supabaseAdmin.from("payment_events").insert({
    payment_id: paymentId,
    kind,
    source,
    from_status: extra.from ?? null,
    to_status: extra.to ?? null,
    detail: extra.detail ?? null,
  });
  // The status change already happened; losing a timeline row must not undo it.
  if (error) console.error(`[payments] failed to record ${kind} event for ${paymentId}`, error);
}

export type TransitionResult =
  { applied: true; payment: PaymentRow } | { applied: false; payment: PaymentRow; reason: string };

/**
 * Move a payment to `to` if the state machine allows it, applying `patch` in
 * the same update. A disallowed transition (a stale or out-of-order webhook,
 * a double click) is recorded and reported, never applied.
 */
export async function transitionPayment(
  paymentId: string,
  to: PaymentState,
  options: { source: EventSource; patch?: PaymentUpdate; detail?: Json },
): Promise<TransitionResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await getPayment(paymentId);
    if (!current) throw new Error(`Payment ${paymentId} not found.`);
    const from = paymentState(current);

    const check = checkTransition(from, to, current.pre_hold_status as TransferState | null);
    if (!check.ok) {
      if (from !== to) {
        await recordEvent(paymentId, "transition_rejected", options.source, {
          from,
          to,
          detail: { reason: check.reason, ...(options.detail ? { context: options.detail } : {}) },
        });
      }
      return { applied: false, payment: current, reason: check.reason };
    }

    const { data, error } = await supabaseAdmin
      .from("payments")
      .update({ ...options.patch, status: to, pre_hold_status: check.preHold })
      .eq("id", paymentId)
      .eq("status", from)
      .select("*")
      .maybeSingle();
    if (error) fail("Update payment status", error);
    if (!data) continue; // Someone else moved it first; re-read and re-check.

    await recordEvent(paymentId, "transition", options.source, {
      from,
      to,
      detail: options.detail,
    });
    return { applied: true, payment: data };
  }
  throw new Error(`Payment ${paymentId} kept changing concurrently.`);
}

/** Update fields without a status change, only while the payment is still in `expected`. */
export async function updatePaymentIfStatus(
  paymentId: string,
  expected: PaymentState,
  patch: PaymentUpdate,
  event: { kind: string; source: EventSource; detail?: Json },
): Promise<PaymentRow | null> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .update(patch)
    .eq("id", paymentId)
    .eq("status", expected)
    .select("*")
    .maybeSingle();
  if (error) fail("Update payment", error);
  if (data) await recordEvent(paymentId, event.kind, event.source, { detail: event.detail });
  return data;
}

/** Update fields regardless of status (funding evidence, partner snapshots). */
export async function updatePayment(
  paymentId: string,
  patch: PaymentUpdate,
  event: { kind: string; source: EventSource; detail?: Json },
): Promise<PaymentRow> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .update(patch)
    .eq("id", paymentId)
    .select("*")
    .single();
  if (error || !data) fail("Update payment", error);
  await recordEvent(paymentId, event.kind, event.source, { detail: event.detail });
  return data;
}

/** Update fields without recording a timeline event (bookkeeping columns). */
export async function touchPayment(paymentId: string, patch: PaymentUpdate): Promise<void> {
  const { error } = await supabaseAdmin.from("payments").update(patch).eq("id", paymentId);
  if (error) fail("Update payment", error);
}

/** Record the wallet the user will pay from, while the payment is not funded yet. */
export async function setPayerWallet(
  paymentId: string,
  wallet: string,
): Promise<PaymentRow | null> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .update({ payer_wallet: wallet })
    .eq("id", paymentId)
    .is("funding_signature", null)
    .select("*")
    .maybeSingle();
  if (error) fail("Record payer wallet", error);
  return data;
}

export type FundingWrite =
  | { status: "recorded"; payment: PaymentRow }
  | { status: "already_funded" }
  | { status: "signature_taken" };

/**
 * Store verified funding evidence, only if the payment has none yet. The
 * unique constraint on `funding_signature` makes one transaction fund at most
 * one payment even under concurrent requests.
 */
export async function recordFunding(
  paymentId: string,
  patch: PaymentUpdate & { funding_signature: string },
  event: { kind: string; source: EventSource; detail?: Json },
): Promise<FundingWrite> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .update(patch)
    .eq("id", paymentId)
    .is("funding_signature", null)
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { status: "signature_taken" };
    fail("Record funding", error);
  }
  if (!data) return { status: "already_funded" };
  await recordEvent(paymentId, event.kind, event.source, { detail: event.detail });
  return { status: "recorded", payment: data };
}

/** Store the settled payout once; returns false if it was already recorded. */
export async function recordActualPayout(
  paymentId: string,
  payout: { minor: bigint; currency: string },
  event: { source: EventSource; detail?: Json },
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .update({ actual_payout_minor: Number(payout.minor), actual_payout_currency: payout.currency })
    .eq("id", paymentId)
    .is("actual_payout_minor", null)
    .select("id")
    .maybeSingle();
  if (error) fail("Record actual payout", error);
  if (!data) return false;
  await recordEvent(paymentId, "payout_settled", event.source, { detail: event.detail });
  return true;
}

// -------------------------------------------------------------- travel rule

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TravelRuleMatch = {
  payment: PaymentRow;
  matchedBy: "payment_id" | "transfer_id" | "funding_signature" | "travel_rule_reference";
};

/**
 * The payment a Travel Rule request refers to. Stables does not document
 * which ID `transaction_reference_id` is, so it is tried as our own payment ID
 * (sent as transfer metadata), the transfer ID, the funding transaction
 * signature, then as an earlier request's reference.
 */
export async function getPaymentByTravelRuleReference(
  reference: string,
): Promise<TravelRuleMatch | null> {
  const columns = [
    ...(UUID.test(reference) ? (["id"] as const) : []),
    "transfer_id",
    "funding_signature",
    "travel_rule_reference",
  ] as const;
  for (const column of columns) {
    const { data, error } = await supabaseAdmin
      .from("payments")
      .select("*")
      .eq(column, reference)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) fail("Load payment by Travel Rule reference", error);
    if (data[0]) return { payment: data[0], matchedBy: column === "id" ? "payment_id" : column };
  }
  return null;
}

type TravelRulePatch = Required<
  Pick<
    PaymentUpdate,
    | "travel_rule_reference"
    | "travel_rule_verification_url"
    | "travel_rule_expires_at"
    | "travel_rule_requested_at"
    | "travel_rule_resolved_at"
  >
>;

/**
 * Store a Travel Rule request, only while the payment still holds the request
 * the caller compared against (`expectedRequestedAt`). Null means another
 * request was stored concurrently; re-read and decide again.
 */
export async function replaceTravelRuleRequest(
  paymentId: string,
  expectedRequestedAt: string | null,
  patch: TravelRulePatch,
  event: { source: EventSource; detail?: Json },
): Promise<PaymentRow | null> {
  const base = supabaseAdmin.from("payments").update(patch).eq("id", paymentId);
  const guarded =
    expectedRequestedAt === null
      ? base.is("travel_rule_requested_at", null)
      : base.eq("travel_rule_requested_at", expectedRequestedAt);
  const { data, error } = await guarded.select("*").maybeSingle();
  if (error) fail("Record Travel Rule request", error);
  if (data) {
    await recordEvent(paymentId, "travel_rule_verification_required", event.source, {
      detail: event.detail,
    });
  }
  return data;
}

/** Mark the Travel Rule request made at `requestedAt` as lifted; false if it is no longer open. */
export async function resolveTravelRule(
  paymentId: string,
  requestedAt: string,
  resolvedAt: string,
  event: { source: EventSource; detail?: Json },
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .update({ travel_rule_resolved_at: resolvedAt })
    .eq("id", paymentId)
    .eq("travel_rule_requested_at", requestedAt)
    .is("travel_rule_resolved_at", null)
    .select("id")
    .maybeSingle();
  if (error) fail("Resolve Travel Rule request", error);
  if (!data) return false;
  await recordEvent(paymentId, "travel_rule_cleared", event.source, { detail: event.detail });
  return true;
}

/**
 * When Stables last moved the transfer to a state that lifts a Travel Rule
 * hold, from the recorded webhook and reconciliation transitions. Uses the
 * Stables-side time (`detail.stables_at`) when one was recorded, since
 * deliveries can be processed out of order.
 */
export async function lastHoldLiftedAt(paymentId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("payment_events")
    .select("created_at, to_status, source, detail")
    .eq("payment_id", paymentId)
    .eq("kind", "transition")
    .in("source", ["webhook", "reconcile"]);
  if (error) fail("Load payment transitions", error);

  let latest: number | null = null;
  for (const row of data) {
    if (!isPaymentState(row.to_status) || !liftsTravelRuleHold(row.to_status)) continue;
    const stablesAt = (row.detail as { stables_at?: unknown } | null)?.stables_at;
    const at = Date.parse(typeof stablesAt === "string" ? stablesAt : row.created_at);
    if (Number.isFinite(at) && (latest === null || at > latest)) latest = at;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

/** Payments of a user still waiting on identity verification. */
export async function listPaymentsAwaitingKyc(userId: string): Promise<PaymentRow[]> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["PAYMENT_CREATED", "KYC_PENDING"]);
  if (error) fail("Load payments awaiting KYC", error);
  return data;
}

// ---------------------------------------------------------------- customers

export async function getStablesCustomerForUser(
  userId: string,
): Promise<StablesCustomerRow | null> {
  const { data, error } = await supabaseAdmin
    .from("stables_customers")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("Load Stables customer", error);
  return data;
}

export async function getStablesCustomerById(
  stablesCustomerId: string,
): Promise<StablesCustomerRow | null> {
  const { data, error } = await supabaseAdmin
    .from("stables_customers")
    .select("*")
    .eq("stables_customer_id", stablesCustomerId)
    .maybeSingle();
  if (error) fail("Load Stables customer", error);
  return data;
}

export async function upsertStablesCustomer(
  row: Tables["stables_customers"]["Insert"],
): Promise<StablesCustomerRow> {
  const { data, error } = await supabaseAdmin
    .from("stables_customers")
    .upsert(row, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error || !data) fail("Save Stables customer", error);
  return data;
}

// ----------------------------------------------------------------- webhooks

/**
 * Claim a webhook delivery by its event_id. "duplicate" means it was already
 * processed; "retry" means an earlier delivery was stored but not processed.
 */
export async function claimWebhookEvent(row: Tables["stables_webhook_events"]["Insert"]) {
  const { data, error } = await supabaseAdmin
    .from("stables_webhook_events")
    .upsert(row, { onConflict: "event_id", ignoreDuplicates: true })
    .select("event_id");
  if (error) fail("Store webhook event", error);
  if (data.length > 0) return "new" as const;

  const { data: existing, error: readError } = await supabaseAdmin
    .from("stables_webhook_events")
    .select("processed_at")
    .eq("event_id", row.event_id)
    .single();
  if (readError || !existing) fail("Load webhook event", readError);
  return existing.processed_at ? ("duplicate" as const) : ("retry" as const);
}

export async function finishWebhookEvent(
  eventId: string,
  outcome: { processed: boolean; note?: string },
) {
  const { error } = await supabaseAdmin
    .from("stables_webhook_events")
    .update({
      processed_at: outcome.processed ? new Date().toISOString() : null,
      process_error: outcome.note ?? null,
    })
    .eq("event_id", eventId);
  if (error) console.error(`[stables-webhook] failed to update event ${eventId}`, error);
}

/**
 * Payments whose Stables transfer may still change, plus recently completed
 * ones still missing the settled payout. Least recently reconciled first.
 */
export async function listPaymentsToReconcile(limit: number, since: Date): Promise<PaymentRow[]> {
  const base = () =>
    supabaseAdmin
      .from("payments")
      .select("*")
      .not("transfer_id", "is", null)
      .gte("created_at", since.toISOString())
      .order("reconciled_at", { ascending: true, nullsFirst: true })
      .limit(limit);

  const [active, settled] = await Promise.all([
    base().in("status", [...ACTIVE_TRANSFER_STATES]),
    base().eq("status", "COMPLETED").is("actual_payout_minor", null),
  ]);
  if (active.error) fail("Load payments to reconcile", active.error);
  if (settled.error) fail("Load payments to reconcile", settled.error);

  const never = Number.NEGATIVE_INFINITY;
  const at = (p: PaymentRow) => (p.reconciled_at ? Date.parse(p.reconciled_at) : never);
  return [...active.data, ...settled.data].sort((a, b) => at(a) - at(b)).slice(0, limit);
}

/** Stored deliveries never processed, received within [since, before]. Oldest first. */
export async function listUnprocessedWebhookEvents(since: Date, before: Date, limit: number) {
  const { data, error } = await supabaseAdmin
    .from("stables_webhook_events")
    .select("event_id, payload")
    .is("processed_at", null)
    .gte("received_at", since.toISOString())
    .lte("received_at", before.toISOString())
    .order("received_at", { ascending: true })
    .limit(limit);
  if (error) fail("Load unprocessed webhook events", error);
  return data;
}

/**
 * Stored events about `objectId` (a transfer ID, or the reference of a Travel
 * Rule request) that arrived before a payment could be matched to them.
 */
export async function listUnprocessedEventsFor(objectId: string) {
  const { data, error } = await supabaseAdmin
    .from("stables_webhook_events")
    .select("event_id, payload")
    .eq("event_object_id", objectId)
    .is("processed_at", null)
    .order("received_at", { ascending: true });
  if (error) fail("Load pending events", error);
  return data;
}
