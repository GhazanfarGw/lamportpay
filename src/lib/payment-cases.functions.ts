/**
 * Admin server functions for operations cases (refunds/returns and other
 * manual follow-ups). Admins only, through the admin's own session: RLS allows
 * admins to read, open and update cases and to append case history; nobody can
 * edit or delete history. A case never changes the payment's status, and
 * LamportPay never moves customer funds — refunds are done by Stables.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { logAdminActions } from "./admin.audit.server";
import { attentionSignals, reachedFunds, type AttentionSignal } from "./payments/attention";
import {
  CASE_KINDS,
  CASE_STATUSES,
  checkCaseTransition,
  validateCaseFields,
  type CaseFields,
  type CaseStatus,
} from "./payments/cases";

type AdminContext = {
  supabase: {
    rpc: (fn: "has_role", args: { _user_id: string; _role: "admin" }) => unknown;
  };
  userId: string;
  claims?: unknown;
};

async function requireAdmin(context: AdminContext) {
  const { data: isAdmin, error } = (await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  })) as { data: boolean | null; error: unknown };
  if (error) throw new Error("Could not verify admin access.");
  if (!isAdmin) throw new Error("Admin role required.");
}

function actorOf(context: AdminContext) {
  return {
    id: context.userId,
    email: (context.claims as { email?: string } | null)?.email ?? null,
  };
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
const optionalMinor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional();

const fieldsSchema = z
  .object({
    stables_reference: optionalText(200),
    original_wallet: optionalText(64),
    original_amount_minor: optionalMinor,
    asset: z.enum(["usdc", "usdt"]).nullable().optional(),
    refund_amount_minor: optionalMinor,
    refund_destination: optionalText(200),
    stables_communication: optionalText(2000),
    refund_tx_signature: optionalText(100),
  })
  .strict();

function checkedFields(fields: CaseFields | undefined): CaseFields {
  const clean = Object.fromEntries(
    Object.entries(fields ?? {}).filter(([, v]) => v !== undefined),
  ) as CaseFields;
  const problem = validateCaseFields(clean);
  if (problem) throw new Error(problem);
  return clean;
}

export type AdminCase = {
  id: string;
  payment_id: string;
  kind: string;
  status: CaseStatus;
  reason: string;
  stables_reference: string | null;
  original_wallet: string | null;
  original_amount_minor: number | null;
  asset: string | null;
  refund_amount_minor: number | null;
  refund_destination: string | null;
  stables_communication: string | null;
  refund_tx_signature: string | null;
  opened_by: string | null;
  customer_notified_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminCaseEvent = {
  id: number;
  case_id: string;
  actor_email: string | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  changes: Json | null;
  created_at: string;
};

/**
 * Cases, their history, the operations alerts and prefill values for one
 * payment. Alerts are computed from the payment, its status history, stored
 * webhook failures and open cases (lib/payments/attention).
 */
export const getPaymentCasesAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ paymentId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await requireAdmin(context);

    const paymentResult = await supabase
      .from("payments")
      .select(
        "id, status, created_at, quote_expires_at, transfer_id, funding_signature, funding_verified_at, payer_wallet, deposit_amount_minor, source_currency",
      )
      .eq("id", data.paymentId)
      .maybeSingle();
    if (paymentResult.error) throw new Error(paymentResult.error.message);
    const payment = paymentResult.data;
    if (!payment) throw new Error("Payment not found.");

    const [casesResult, eventsResult, webhookResult] = await Promise.all([
      supabase
        .from("payment_cases")
        .select("*")
        .eq("payment_id", payment.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("payment_events")
        .select("kind, to_status, created_at, detail")
        .eq("payment_id", payment.id)
        .order("id", { ascending: true }),
      payment.transfer_id
        ? supabase
            .from("stables_webhook_events")
            .select("event_id")
            .eq("event_object_id", payment.transfer_id)
            .is("processed_at", null)
            .not("process_error", "is", null)
            .limit(1)
        : Promise.resolve({ data: [] as { event_id: string }[], error: null }),
    ]);
    for (const r of [casesResult, eventsResult, webhookResult]) {
      if (r.error) throw new Error(r.error.message);
    }
    const cases = (casesResult.data ?? []) as AdminCase[];
    const caseIds = cases.map((c) => c.id);
    const caseEvents = caseIds.length
      ? await supabase
          .from("payment_case_events")
          .select(
            "id, case_id, actor_email, action, from_status, to_status, note, changes, created_at",
          )
          .in("case_id", caseIds)
          .order("id", { ascending: true })
      : { data: [] as AdminCaseEvent[], error: null };
    if (caseEvents.error) throw new Error(caseEvents.error.message);

    const events = eventsResult.data ?? [];
    const transitions = events.filter((e) => e.to_status !== null);
    const lastChange = transitions.at(-1)?.created_at ?? null;
    // Same rule as the admin list: a rejected deposit that still moved funds.
    const depositMismatch = events.some((e) => {
      if (e.kind !== "funding_rejected") return false;
      const received = (e.detail as Record<string, unknown> | null)?.["received_minor"];
      return typeof received === "string" && /^\d+$/.test(received) && BigInt(received) > 0n;
    });

    const signals: AttentionSignal[] = attentionSignals({
      ...payment,
      status_changed_at: lastChange,
      depositMismatch,
      everCollectedFunds: reachedFunds(transitions.map((e) => e.to_status)),
      webhookError: (webhookResult.data ?? []).length > 0,
      openCase: cases.some((c) => c.status !== "closed"),
    });

    return {
      cases,
      events: (caseEvents.data ?? []) as AdminCaseEvent[],
      signals,
      prefill: {
        stables_reference: payment.transfer_id,
        original_wallet: payment.payer_wallet,
        original_amount_minor: payment.deposit_amount_minor,
        asset: (payment.source_currency === "usdt" ? "usdt" : "usdc") as "usdc" | "usdt",
      },
    };
  });

/** Open a case for a payment. At most one open case per payment (database rule). */
export const openPaymentCaseAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        paymentId: z.string().uuid(),
        kind: z.enum(CASE_KINDS),
        reason: z.string().trim().min(3).max(2000),
        fields: fieldsSchema.optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireAdmin(context);
    const fields = checkedFields(data.fields);

    const { data: created, error } = await supabase
      .from("payment_cases")
      .insert({
        payment_id: data.paymentId,
        kind: data.kind,
        reason: data.reason,
        opened_by: userId,
        ...fields,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error(
          error.message.includes("refund_tx")
            ? "That refund transaction is already recorded on another case."
            : "This payment already has an open case. Update it instead.",
        );
      }
      if (error.code === "23503") throw new Error("Payment not found.");
      throw new Error(error.message);
    }
    const actor = actorOf(context);
    const { error: eventError } = await supabase.from("payment_case_events").insert({
      case_id: created.id,
      actor_id: userId,
      actor_email: actor.email,
      action: "opened",
      to_status: created.status,
      note: data.reason,
      changes: { kind: data.kind, ...fields } as Json,
    });
    if (eventError) console.error("[cases] failed to record case history", eventError.message);
    await logAdminActions(supabase, actor, [
      {
        entityType: "payment_case",
        entityId: created.id,
        entityReference: data.paymentId,
        action: "case_opened",
        newValue: `${data.kind} / ${created.status}`,
        note: data.reason,
      },
    ]);
    console.info(
      JSON.stringify({
        event: "payment_case_opened",
        case_id: created.id,
        payment_id: data.paymentId,
        kind: data.kind,
      }),
    );
    return created as AdminCase;
  });

/**
 * Move a case along its workflow and/or record facts and a note. Status moves
 * are checked against the case workflow (lib/payments/cases); a closed case
 * cannot change.
 */
export const updatePaymentCaseAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        status: z.enum(CASE_STATUSES).optional(),
        fields: fieldsSchema.optional(),
        note: z.string().trim().max(2000).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireAdmin(context);
    const fields = checkedFields(data.fields);
    const note = data.note ? data.note : null;

    const { data: current, error: readError } = await supabase
      .from("payment_cases")
      .select("*")
      .eq("id", data.caseId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) throw new Error("Case not found.");
    const from = current.status as CaseStatus;
    if (from === "closed") throw new Error("This case is closed. Open a new case instead.");

    const changedFields = Object.fromEntries(
      Object.entries(fields).filter(([k, v]) => (current as Record<string, unknown>)[k] !== v),
    ) as CaseFields;
    const statusChange = data.status && data.status !== from ? data.status : null;
    if (statusChange) {
      const check = checkCaseTransition(from, statusChange);
      if (!check.ok) throw new Error(check.reason);
      if (statusChange === "closed" && !note) {
        throw new Error("Add a note saying how the case was resolved before closing it.");
      }
    }
    if (!statusChange && Object.keys(changedFields).length === 0 && !note) {
      throw new Error("Nothing to update.");
    }

    const now = new Date().toISOString();
    const patch = {
      ...changedFields,
      ...(statusChange && { status: statusChange }),
      ...(statusChange === "customer_notified" && { customer_notified_at: now }),
      ...(statusChange === "closed" && { closed_at: now }),
    };
    let updated = current;
    if (Object.keys(patch).length > 0) {
      // Only update the row we read, in the status we read (no lost updates).
      const { data: row, error } = await supabase
        .from("payment_cases")
        .update(patch)
        .eq("id", data.caseId)
        .eq("status", from)
        .select("*")
        .maybeSingle();
      if (error) {
        if (error.code === "23505") {
          throw new Error("That refund transaction is already recorded on another case.");
        }
        throw new Error(error.message);
      }
      if (!row) throw new Error("The case changed meanwhile. Reload and try again.");
      updated = row;
    }

    const actor = actorOf(context);
    const { error: eventError } = await supabase.from("payment_case_events").insert({
      case_id: data.caseId,
      actor_id: userId,
      actor_email: actor.email,
      action: statusChange
        ? "status_changed"
        : Object.keys(changedFields).length
          ? "updated"
          : "note",
      from_status: statusChange ? from : null,
      to_status: statusChange,
      note,
      changes: Object.keys(changedFields).length ? (changedFields as Json) : null,
    });
    if (eventError) console.error("[cases] failed to record case history", eventError.message);
    await logAdminActions(supabase, actor, [
      {
        entityType: "payment_case",
        entityId: data.caseId,
        entityReference: current.payment_id,
        action: statusChange ? "case_status_changed" : "case_updated",
        field: statusChange ? "status" : Object.keys(changedFields).join(",") || "note",
        oldValue: statusChange ? from : null,
        newValue: statusChange,
        note,
      },
    ]);
    console.info(
      JSON.stringify({
        event: "payment_case_updated",
        case_id: data.caseId,
        payment_id: current.payment_id,
        from_status: from,
        to_status: statusChange,
        fields: Object.keys(changedFields),
      }),
    );
    return updated as AdminCase;
  });

/**
 * "Recheck Stables": read the transfer from Stables now (bypassing the 8 s
 * throttle) and apply what Stables reports, through the normal forward-only
 * state machine. It never sets a status by itself.
 */
export const recheckStablesAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ paymentId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { syncPaymentById } = await import("@/lib/payments/service.server");
    const before = await context.supabase
      .from("payments")
      .select("status")
      .eq("id", data.paymentId)
      .maybeSingle();
    if (before.error) throw new Error(before.error.message);
    if (!before.data) throw new Error("Payment not found.");
    await syncPaymentById(data.paymentId, { force: true });
    const after = await context.supabase
      .from("payments")
      .select("status")
      .eq("id", data.paymentId)
      .maybeSingle();
    if (after.error) throw new Error(after.error.message);
    console.info(
      JSON.stringify({
        event: "admin_recheck_stables",
        payment_id: data.paymentId,
        from_status: before.data.status,
        to_status: after.data?.status ?? null,
      }),
    );
    return { before: before.data.status, after: after.data?.status ?? before.data.status };
  });

/** Open cases across all payments, newest first (operations queue). */
export const getOpenCasesAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await context.supabase
      .from("payment_cases")
      .select("*")
      .neq("status", "closed")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as AdminCase[];
  });
