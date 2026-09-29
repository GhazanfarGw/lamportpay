import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toPaymentView } from "@/lib/payments/view";
import { logAdminActions } from "./admin.audit.server";
import {
  ADMIN_KYC_STATUSES,
  ADMIN_PAYMENT_STATUSES,
  ADMIN_QUOTE_STATUSES,
  ASSIGNABLE_ROLES,
  AUDIT_COLUMNS,
  KYC_COLUMNS,
  STABLES_PAYMENT_COLUMNS,
  TRANSFER_COLUMNS,
  TRANSFER_DETAIL_COLUMNS,
  type AdminAuditRow,
  type AdminInviteRow,
  type AdminKycRow,
  type AdminRoleRow,
  type AdminStablesPaymentRow,
  type AdminTransferDetail,
  type AdminTransferRow,
  type AdminUnmatchedTravelRule,
  type PaymentStatus,
  type QuoteStatus,
} from "./admin.constants";

async function requireAdmin(context: {
  supabase: { rpc: (fn: "has_role", args: { _user_id: string; _role: "admin" }) => unknown };
  userId: string;
}) {
  const { data: isAdmin, error } = (await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  })) as { data: boolean | null; error: unknown };
  if (error) throw new Error("Could not verify admin access.");
  if (!isAdmin) throw new Error("Admin role required.");
}

/**
 * One live Stables payment for admins: the same view (and receipt) the user
 * sees, plus the owner, the full timeline with details, and whether the
 * Stables connection is the sandbox (deposit simulation is offered there only).
 */
export const getStablesPaymentDetailAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await requireAdmin(context);

    const [paymentResult, eventsResult] = await Promise.all([
      supabase.from("payments").select("*").eq("id", data.id).maybeSingle(),
      supabase
        .from("payment_events")
        .select("created_at, kind, from_status, to_status, source, detail")
        .eq("payment_id", data.id)
        .order("id", { ascending: true }),
    ]);
    if (paymentResult.error) throw new Error(paymentResult.error.message);
    if (eventsResult.error) throw new Error(eventsResult.error.message);
    const payment = paymentResult.data;
    if (!payment) throw new Error("Payment not found.");
    const events = eventsResult.data ?? [];

    const { getStablesConfig } = await import("@/lib/stables/config.server");
    const config = getStablesConfig();
    return {
      payment: toPaymentView(payment, events),
      userId: payment.user_id,
      timeline: events.map((e) => ({
        at: e.created_at,
        kind: e.kind,
        from: e.from_status,
        to: e.to_status,
        source: e.source,
        detail: e.detail === null ? null : JSON.stringify(e.detail),
      })),
      stablesEnvironment: config.configured ? config.environment : ("unconfigured" as const),
    };
  });

/**
 * SANDBOX ONLY: simulate the incoming deposit of a payment's Stables transfer
 * (POST /transfers/{id}/sandbox/simulate-deposit). Admins only; the service
 * refuses with a live (sti_live_) key or a production URL.
 */
export const simulateSandboxDepositAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { simulateSandboxDeposit, PaymentError } = await import("@/lib/payments/service.server");
    try {
      return await simulateSandboxDeposit(data.id, {
        id: context.userId,
        email: (context.claims as { email?: string } | null)?.email ?? null,
      });
    } catch (e) {
      if (e instanceof PaymentError) throw new Error(e.message);
      throw e;
    }
  });

/**
 * Live Stables payments for operations: the latest payments, every payment
 * with an open Travel Rule wallet-verification request, and Travel Rule
 * requests that matched no payment. Read through the admin's own session;
 * RLS lets admins read payments and stored webhook deliveries.
 */
export const getStablesPaymentsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleError) throw new Error("Could not verify admin access.");
    if (!isAdmin) {
      return {
        isAdmin: false,
        payments: [] as AdminStablesPaymentRow[],
        travelRuleOpen: [] as AdminStablesPaymentRow[],
        travelRuleUnmatched: [] as AdminUnmatchedTravelRule[],
      };
    }

    const [recent, open, unmatched, rejectedDeposits] = await Promise.all([
      supabase
        .from("payments")
        .select(STABLES_PAYMENT_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("payments")
        .select(STABLES_PAYMENT_COLUMNS)
        .not("travel_rule_requested_at", "is", null)
        .is("travel_rule_resolved_at", null)
        .order("travel_rule_requested_at", { ascending: false })
        .limit(50),
      supabase
        .from("stables_webhook_events")
        .select("event_id, event_object_id, payload, received_at, process_error")
        .eq("event_type", "travel_rule.wallet_verification_required")
        .is("processed_at", null)
        .order("received_at", { ascending: false })
        .limit(50),
      // Deposits we rejected although funds reached the deposit address.
      supabase
        .from("payment_events")
        .select("payment_id, detail")
        .eq("kind", "funding_rejected")
        .order("id", { ascending: false })
        .limit(200),
    ]);
    for (const result of [recent, open, unmatched, rejectedDeposits]) {
      if (result.error) throw new Error(result.error.message);
    }

    const text = (value: unknown) => (typeof value === "string" ? value : null);
    const fundsMoved = new Set(
      (rejectedDeposits.data ?? [])
        .filter((e) => {
          const received = text((e.detail as Record<string, unknown> | null)?.["received_minor"]);
          return received !== null && /^\d+$/.test(received) && BigInt(received) > 0n;
        })
        .map((e) => e.payment_id),
    );
    const withIssue = (rows: unknown[] | null) =>
      ((rows ?? []) as AdminStablesPaymentRow[]).map((row) => ({
        ...row,
        deposit_issue: !row.funding_signature && fundsMoved.has(row.id),
      }));
    return {
      isAdmin: true,
      payments: withIssue(recent.data),
      travelRuleOpen: withIssue(open.data),
      travelRuleUnmatched: (unmatched.data ?? []).map((row): AdminUnmatchedTravelRule => {
        const object = ((row.payload as { event_object?: unknown } | null)?.event_object ??
          {}) as Record<string, unknown>;
        return {
          eventId: row.event_id,
          reference: text(object["transaction_reference_id"]) ?? row.event_object_id,
          verificationUrl: text(object["verification_url"]),
          expiresAt: text(object["expires_at"]),
          receivedAt: row.received_at,
          note: row.process_error,
        };
      }),
    };
  });

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleError) throw new Error("Could not verify admin access.");
    if (!isAdmin) {
      return {
        isAdmin: false,
        kyc: [] as AdminKycRow[],
        transfers: [] as AdminTransferRow[],
        audit: [] as AdminAuditRow[],
      };
    }

    const [kycResult, transferResult, auditResult] = await Promise.all([
      supabase
        .from("mock_kyc_submissions")
        .select(KYC_COLUMNS)
        .order("created_at", { ascending: false }),
      supabase
        .from("mock_payout_transfers")
        .select(TRANSFER_COLUMNS)
        .order("created_at", { ascending: false }),
      supabase
        .from("admin_audit_log")
        .select(AUDIT_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (kycResult.error) throw new Error(kycResult.error.message);
    if (transferResult.error) throw new Error(transferResult.error.message);
    if (auditResult.error) throw new Error(auditResult.error.message);

    return {
      isAdmin: true,
      kyc: (kycResult.data ?? []) as unknown as AdminKycRow[],
      transfers: (transferResult.data ?? []) as unknown as AdminTransferRow[],
      audit: (auditResult.data ?? []) as unknown as AdminAuditRow[],
    };
  });

export const reviewKycSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(ADMIN_KYC_STATUSES),
        reviewNote: z.string().max(500).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;

    const { data: previous } = await supabase
      .from("mock_kyc_submissions")
      .select("status")
      .eq("id", data.id)
      .maybeSingle();

    const { data: updated, error } = await supabase
      .from("mock_kyc_submissions")
      .update({
        status: data.status,
        review_note: data.reviewNote?.trim() ? data.reviewNote.trim() : null,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .select(KYC_COLUMNS)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Submission not found or access denied.");

    const row = updated as unknown as AdminKycRow;
    await logAdminActions(
      supabase,
      { id: userId, email: (claims as { email?: string } | null)?.email ?? null },
      [
        {
          entityType: "kyc_submission",
          entityId: row.id,
          entityReference: row.reference,
          action: data.status === "approved" ? "kyc_approved" : `kyc_${data.status}`,
          field: "status",
          oldValue: (previous as { status?: string } | null)?.status ?? null,
          newValue: data.status,
          note: row.review_note,
        },
      ],
    );

    return row;
  });

export const updateTransferStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        quoteStatus: z.enum(ADMIN_QUOTE_STATUSES).optional(),
        paymentStatus: z.enum(ADMIN_PAYMENT_STATUSES).optional(),
        adminNote: z.string().max(500).optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.quoteStatus !== undefined ||
          value.paymentStatus !== undefined ||
          value.adminNote !== undefined,
        { message: "Nothing to update." },
      )
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;

    const { data: previousRow } = await supabase
      .from("mock_payout_transfers")
      .select("quote_status, payment_status, admin_note")
      .eq("id", data.id)
      .maybeSingle();
    const previous = (previousRow ?? {}) as {
      quote_status?: string;
      payment_status?: string;
      admin_note?: string | null;
    };

    const patch: {
      updated_by: string;
      quote_status?: QuoteStatus;
      payment_status?: PaymentStatus;
      admin_note?: string | null;
      funded_at?: string;
      settled_at?: string;
    } = { updated_by: userId };
    if (data.quoteStatus) patch.quote_status = data.quoteStatus;
    if (data.paymentStatus) patch.payment_status = data.paymentStatus;
    if (data.adminNote !== undefined) {
      patch.admin_note = data.adminNote.trim() ? data.adminNote.trim() : null;
    }
    if (data.paymentStatus === "processing") patch.funded_at = new Date().toISOString();
    if (data.paymentStatus === "paid") patch.settled_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from("mock_payout_transfers")
      .update(patch)
      .eq("id", data.id)
      .select(TRANSFER_COLUMNS)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Transfer not found or access denied.");

    const row = updated as unknown as AdminTransferRow;
    const entries: {
      field: string;
      oldValue: string | null;
      newValue: string | null;
      action: string;
    }[] = [];
    if (data.quoteStatus && data.quoteStatus !== previous.quote_status) {
      entries.push({
        field: "quote_status",
        oldValue: previous.quote_status ?? null,
        newValue: data.quoteStatus,
        action: "quote_status_changed",
      });
    }
    if (data.paymentStatus && data.paymentStatus !== previous.payment_status) {
      entries.push({
        field: "payment_status",
        oldValue: previous.payment_status ?? null,
        newValue: data.paymentStatus,
        action: "payment_status_changed",
      });
    }
    if (data.adminNote !== undefined && (patch.admin_note ?? null) !== (previous.admin_note ?? null)) {
      entries.push({
        field: "admin_note",
        oldValue: previous.admin_note ?? null,
        newValue: patch.admin_note ?? null,
        action: "note_updated",
      });
    }

    await logAdminActions(
      supabase,
      { id: userId, email: (claims as { email?: string } | null)?.email ?? null },
      entries.map((entry) => ({
        ...entry,
        entityType: "payout_transfer" as const,
        entityId: row.id,
        entityReference: row.reference,
      })),
    );

    return row;
  });

export const getPaymentDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: transfer, error } = await supabase
      .from("mock_payout_transfers")
      .select(TRANSFER_DETAIL_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!transfer) throw new Error("Payment not found, or your account is not an admin.");

    const detail = transfer as unknown as AdminTransferDetail;

    const [kycResult, auditResult] = await Promise.all([
      detail.kyc_submission_id
        ? supabase
            .from("mock_kyc_submissions")
            .select(KYC_COLUMNS)
            .eq("id", detail.kyc_submission_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("admin_audit_log")
        .select(AUDIT_COLUMNS)
        .eq("entity_id", data.id)
        .order("created_at", { ascending: false }),
    ]);

    if (auditResult.error) throw new Error(auditResult.error.message);

    return {
      transfer: detail,
      kyc: (kycResult.data ?? null) as unknown as AdminKycRow | null,
      audit: (auditResult.data ?? []) as unknown as AdminAuditRow[],
    };
  });

export const getRoleManagement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleError) throw new Error("Could not verify admin access.");
    if (!isAdmin) {
      return { isAdmin: false, roles: [] as AdminRoleRow[], invites: [] as AdminInviteRow[] };
    }

    const [rolesResult, invitesResult] = await Promise.all([
      supabase
        .from("user_roles")
        .select("id, user_id, role, created_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("admin_invites")
        .select("id, email, role, status, accepted_at, created_at")
        .order("created_at", { ascending: false }),
    ]);
    if (rolesResult.error) throw new Error(rolesResult.error.message);
    if (invitesResult.error) throw new Error(invitesResult.error.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: userList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const emailById = new Map((userList?.users ?? []).map((user) => [user.id, user.email ?? null]));

    return {
      isAdmin: true,
      roles: (rolesResult.data ?? []).map((row) => ({
        ...row,
        email: emailById.get(row.user_id) ?? null,
      })) as unknown as AdminRoleRow[],
      invites: (invitesResult.data ?? []) as unknown as AdminInviteRow[],
    };
  });

export const grantRoleByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().email().max(200),
        role: z.enum(ASSIGNABLE_ROLES),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const actor = { id: userId, email: (claims as { email?: string } | null)?.email ?? null };

    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleError) throw new Error("Could not verify admin access.");
    if (!isAdmin) throw new Error("Forbidden");

    const email = data.email.trim().toLowerCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: userList, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listError) throw new Error(listError.message);
    const match = (userList?.users ?? []).find(
      (user) => (user.email ?? "").toLowerCase() === email,
    );

    if (match) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: match.id, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);

      await logAdminActions(supabase, actor, [
        {
          entityType: "user_role",
          entityId: match.id,
          entityReference: email,
          action: "role_granted",
          field: "role",
          newValue: data.role,
        },
      ]);
      return { granted: true as const, invited: false as const, email };
    }

    const { error: inviteError } = await supabaseAdmin
      .from("admin_invites")
      .upsert(
        { email, role: data.role, status: "pending", invited_by: userId },
        { onConflict: "email" },
      );
    if (inviteError) throw new Error(inviteError.message);

    await logAdminActions(supabase, actor, [
      {
        entityType: "admin_invite",
        entityReference: email,
        action: "invite_created",
        field: "role",
        newValue: data.role,
      },
    ]);
    return { granted: false as const, invited: true as const, email };
  });

export const revokeRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ userId: z.string().uuid(), role: z.enum(ASSIGNABLE_ROLES) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;

    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleError) throw new Error("Could not verify admin access.");
    if (!isAdmin) throw new Error("Forbidden");
    if (data.userId === userId && data.role === "admin") {
      throw new Error("You cannot revoke your own admin role.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.role === "admin") {
      const { count, error: countError } = await supabaseAdmin
        .from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      if (countError) throw new Error(countError.message);
      if ((count ?? 0) <= 1) throw new Error("At least one admin must remain.");
    }

    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", data.role);
    if (error) throw new Error(error.message);

    await logAdminActions(
      supabase,
      { id: userId, email: (claims as { email?: string } | null)?.email ?? null },
      [
        {
          entityType: "user_role",
          entityId: data.userId,
          action: "role_revoked",
          field: "role",
          oldValue: data.role,
        },
      ],
    );
    return { revoked: true };
  });

export const cancelAdminInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;

    const { data: deleted, error } = await supabase
      .from("admin_invites")
      .delete()
      .eq("id", data.id)
      .select("email, role")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!deleted) throw new Error("Invite not found or access denied.");

    const row = deleted as { email: string; role: string };
    await logAdminActions(
      supabase,
      { id: userId, email: (claims as { email?: string } | null)?.email ?? null },
      [
        {
          entityType: "admin_invite",
          entityReference: row.email,
          action: "invite_cancelled",
          field: "role",
          oldValue: row.role,
        },
      ],
    );
    return { cancelled: true };
  });

/**
 * Lets a signed-in user redeem a pending invite that matches their own verified
 * email address. Nothing is granted when no matching pending invite exists.
 */
export const redeemAdminInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: user, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userError) throw new Error(userError.message);
    const email = (user?.user?.email ?? "").toLowerCase();
    if (!email) throw new Error("Your account has no email address.");

    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("admin_invites")
      .select("id, role, status")
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();
    if (inviteError) throw new Error(inviteError.message);
    if (!invite) throw new Error("No pending invite found for your account.");

    const { error: grantError } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: invite.role }, { onConflict: "user_id,role" });
    if (grantError) throw new Error(grantError.message);

    await supabaseAdmin
      .from("admin_invites")
      .update({ status: "accepted", accepted_by: userId, accepted_at: new Date().toISOString() })
      .eq("id", invite.id);

    await logAdminActions(supabase, { id: userId, email }, [
      {
        entityType: "admin_invite",
        entityId: invite.id,
        entityReference: email,
        action: "invite_accepted",
        field: "role",
        newValue: invite.role,
      },
    ]);

    return { role: invite.role };
  });

/**
 * Demo bootstrap: lets the first signed-in operator claim the admin role while
 * no admin exists yet. Once an admin exists this always refuses.
 */
export const claimFirstAdminRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { count, error: countError } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) > 0) {
      throw new Error("An admin already exists. Ask them to grant your account access.");
    }

    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: context.userId, role: "admin" });
    if (error) throw new Error(error.message);
    return { granted: true };
  });

/**
 * Business settings for the admin dashboard: LamportPay's conversion fee, the
 * swap fee, the revenue wallet and the payment coins, each with where its value
 * comes from (admin override or .env). No secrets: the revenue wallet and the
 * Jupiter referral account are public addresses; API keys are never read here.
 */
export const getBusinessSettingsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { getBusinessSettings } = await import("@/lib/business-settings.server");
    let settings;
    let error: string | null = null;
    try {
      settings = await getBusinessSettings();
    } catch (e) {
      error = e instanceof Error ? e.message : "Settings are invalid.";
    }
    const referral = process.env["JUPITER_REFERRAL_ACCOUNT"]?.trim() || null;
    return { settings: settings ?? null, error, jupiterReferralAccount: referral };
  });

const PAYMENT_COIN = z.enum(["usdc", "usdt"]);

export const updateBusinessSettingsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversionFeeBps: z.number().int().min(0).max(1000).nullable().optional(),
        swapFeeBps: z.number().int().min(0).max(255).nullable().optional(),
        revenueWallet: z
          .string()
          .trim()
          .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Enter a Solana address.")
          .nullable()
          .optional(),
        enabledCurrencies: z.array(PAYMENT_COIN).min(1).max(2).nullable().optional(),
        note: z.string().trim().max(300).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase, userId, claims } = context;
    const actor = { id: userId, email: (claims as { email?: string } | null)?.email ?? null };
    const { updateBusinessSettings, bpsLabel } = await import("@/lib/business-settings.server");
    const { note, ...patch } = data;

    let result;
    try {
      result = await updateBusinessSettings(patch, userId);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Could not save the settings.");
    }
    const { before, after } = result;
    const show = {
      conversionFeeBps: (s: typeof before) => bpsLabel(s.conversionFeeBps),
      swapFeeBps: (s: typeof before) => bpsLabel(s.swapFeeBps),
      revenueWallet: (s: typeof before) => s.revenueWallet ?? "none",
      enabledCurrencies: (s: typeof before) => s.enabledCurrencies.join(","),
    };
    const entries = (Object.keys(show) as (keyof typeof show)[])
      .filter((field) => show[field](before) !== show[field](after))
      .map((field) => ({
        entityType: "business_settings" as const,
        entityReference: "business_settings",
        action: "setting_changed",
        field,
        oldValue: show[field](before),
        newValue: show[field](after),
        note: note ?? null,
      }));
    await logAdminActions(supabase, actor, entries);
    return { settings: after, changed: entries.length };
  });
