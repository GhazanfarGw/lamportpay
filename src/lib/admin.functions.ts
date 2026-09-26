import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActions } from "./admin.audit.server";
import {
  ADMIN_KYC_STATUSES,
  ADMIN_PAYMENT_STATUSES,
  ADMIN_QUOTE_STATUSES,
  ASSIGNABLE_ROLES,
  AUDIT_COLUMNS,
  KYC_COLUMNS,
  TRANSFER_COLUMNS,
  TRANSFER_DETAIL_COLUMNS,
  type AdminAuditRow,
  type AdminInviteRow,
  type AdminKycRow,
  type AdminRoleRow,
  type AdminTransferDetail,
  type AdminTransferRow,
  type PaymentStatus,
  type QuoteStatus,
} from "./admin.constants";

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
