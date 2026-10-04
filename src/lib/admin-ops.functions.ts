/**
 * Server functions for the admin application (/admin/*): session, dashboard,
 * revenue, reports, audit log and system status. Every function checks the
 * admin role server-side and reads through the admin's own session, so RLS
 * still applies. Numbers come only from stored records — nothing is invented;
 * where there is no data the answer is empty or zero, never a placeholder.
 * Never returns secrets: provider configuration is reported as booleans.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AUDIT_COLUMNS, type AdminAuditRow } from "./admin.constants";

type AdminContext = {
  supabase: { rpc: (fn: "has_role", args: { _user_id: string; _role: "admin" }) => unknown };
  userId: string;
};

async function isAdmin(context: AdminContext): Promise<boolean> {
  const { data, error } = (await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  })) as { data: boolean | null; error: unknown };
  if (error) throw new Error("Could not verify admin access.");
  return Boolean(data);
}

async function requireAdmin(context: AdminContext): Promise<void> {
  if (!(await isAdmin(context))) throw new Error("Admin role required.");
}

/** Rows scanned for revenue sums; beyond this the answer says it is partial. */
const REVENUE_SCAN_LIMIT = 5000;

type RevenueRow = {
  id: string;
  status: string;
  source_currency: string;
  deposit_currency: string | null;
  source_amount_minor: number;
  platform_fee_bps: number | null;
  platform_fee_minor: number | null;
  platform_fee_received_minor: number | null;
  funding_verified_at: string | null;
  funding_signature: string | null;
  created_at: string;
};

const REVENUE_COLUMNS =
  "id, status, source_currency, deposit_currency, source_amount_minor, platform_fee_bps, platform_fee_minor, platform_fee_received_minor, funding_verified_at, funding_signature, created_at";

/** Revenue status of one payment, from stored records only. */
function revenueStatus(row: RevenueRow): "received" | "short" | "missing" | "pending" {
  const expected = row.platform_fee_minor ?? 0;
  if (!row.funding_verified_at) return "pending";
  const received = row.platform_fee_received_minor ?? 0;
  if (received >= expected) return "received";
  return received > 0 ? "short" : "missing";
}

/** Who is signed in, and whether they are an admin (for the admin shell). */
export const getAdminSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await isAdmin(context);
    const email = (context.claims as { email?: string } | null)?.email ?? null;
    if (!admin) return { isAdmin: false, email, stablesEnvironment: null };
    const { getStablesConfig } = await import("@/lib/stables/config.server");
    const stables = getStablesConfig();
    return {
      isAdmin: true,
      email,
      stablesEnvironment: stables.configured ? stables.environment : null,
    };
  });

/** Dashboard: real counts and sums from stored payments; nothing invented. */
export const getAdminDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [statuses, recent, revenue, openTravelRule, feeIssues, lastWebhook] = await Promise.all([
      supabase.from("payments").select("status").limit(REVENUE_SCAN_LIMIT),
      supabase
        .from("payments")
        .select(
          "id, status, created_at, source_currency, source_amount_minor, destination_currency, destination_amount_minor, destination_country",
        )
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("payments")
        .select(REVENUE_COLUMNS)
        .gt("platform_fee_minor", 0)
        .limit(REVENUE_SCAN_LIMIT),
      supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .not("travel_rule_requested_at", "is", null)
        .is("travel_rule_resolved_at", null),
      supabase
        .from("payment_events")
        .select("payment_id", { count: "exact", head: true })
        .eq("kind", "platform_fee_mismatch"),
      supabase
        .from("stables_webhook_events")
        .select("received_at, event_type")
        .order("received_at", { ascending: false })
        .limit(1),
    ]);
    for (const r of [statuses, recent, revenue, openTravelRule, feeIssues, lastWebhook]) {
      if (r.error) throw new Error(r.error.message);
    }

    const byStatus: Record<string, number> = {};
    for (const row of statuses.data ?? []) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    const rows = (revenue.data ?? []) as RevenueRow[];
    let receivedMinor = 0n;
    let received24hMinor = 0n;
    for (const row of rows) {
      const got = BigInt(row.platform_fee_received_minor ?? 0);
      receivedMinor += got;
      if (row.funding_verified_at && row.funding_verified_at >= since) received24hMinor += got;
    }
    return {
      totals: {
        payments: (statuses.data ?? []).length,
        partial: (statuses.data ?? []).length >= REVENUE_SCAN_LIMIT,
        byStatus,
      },
      revenue: {
        currency: "usdc",
        receivedMinor: receivedMinor.toString(),
        received24hMinor: received24hMinor.toString(),
        paymentsWithFee: rows.length,
      },
      attention: {
        openTravelRule: openTravelRule.count ?? 0,
        feeMismatches: feeIssues.count ?? 0,
      },
      recent: recent.data ?? [],
      lastWebhook: lastWebhook.data?.[0] ?? null,
    };
  });

/** Payment-level revenue for the Fees & Revenue page. */
export const getRevenuePayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await context.supabase
      .from("payments")
      .select(REVENUE_COLUMNS)
      .gt("platform_fee_minor", 0)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return ((data ?? []) as RevenueRow[]).map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      verifiedAt: row.funding_verified_at,
      currency: row.deposit_currency ?? row.source_currency,
      amountMinor: String(row.source_amount_minor),
      feeBps: row.platform_fee_bps,
      feeMinor: String(row.platform_fee_minor ?? 0),
      receivedMinor:
        row.platform_fee_received_minor === null ? null : String(row.platform_fee_received_minor),
      signature: row.funding_signature,
      revenueStatus: revenueStatus(row),
    }));
  });

const PERIODS = { day: 1, week: 7, month: 30 } as const;

function bucketStart(iso: string, period: keyof typeof PERIODS): string {
  const d = new Date(iso);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (period === "day") return new Date(day).toISOString().slice(0, 10);
  if (period === "month") return new Date(day).toISOString().slice(0, 7);
  // Weeks start on Monday (UTC).
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  return new Date(day - weekday * 86_400_000).toISOString().slice(0, 10);
}

/** Revenue received per day, week or month (UTC), from verified fundings. */
export const getRevenueReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ period: z.enum(["day", "week", "month"]) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: rows, error } = await context.supabase
      .from("payments")
      .select(REVENUE_COLUMNS)
      .gt("platform_fee_minor", 0)
      .not("funding_verified_at", "is", null)
      .order("funding_verified_at", { ascending: false })
      .limit(REVENUE_SCAN_LIMIT);
    if (error) throw new Error(error.message);
    const buckets = new Map<string, { expected: bigint; received: bigint; payments: number }>();
    for (const row of (rows ?? []) as RevenueRow[]) {
      const key = bucketStart(row.funding_verified_at!, data.period);
      const b = buckets.get(key) ?? { expected: 0n, received: 0n, payments: 0 };
      b.expected += BigInt(row.platform_fee_minor ?? 0);
      b.received += BigInt(row.platform_fee_received_minor ?? 0);
      b.payments += 1;
      buckets.set(key, b);
    }
    return {
      period: data.period,
      currency: "usdc",
      partial: (rows ?? []).length >= REVENUE_SCAN_LIMIT,
      rows: [...buckets]
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .map(([start, b]) => ({
          start,
          payments: b.payments,
          expectedMinor: b.expected.toString(),
          receivedMinor: b.received.toString(),
        })),
    };
  });

/** Audit log, newest first, optionally filtered by entity type. */
export const getAuditLogAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        entityType: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(500),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    let query = context.supabase
      .from("admin_audit_log")
      .select(AUDIT_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.entityType) query = query.eq("entity_type", data.entityType);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as AdminAuditRow[];
  });

/**
 * What the server can actually see about its providers and settings: whether
 * each is configured (booleans only), the Stables environment, the latest
 * stored webhook delivery, and whether business settings are valid. It does
 * not call providers, so it never claims one is "up".
 */
export const getSystemStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const [{ getStablesConfig, getStablesWebhookSecret }, { getBusinessSettings }, limitsMod] =
      await Promise.all([
        import("@/lib/stables/config.server"),
        import("@/lib/business-settings.server"),
        import("@/lib/payments/limits.server"),
      ]);
    const stables = getStablesConfig();
    let settingsError: string | null = null;
    let settings = null;
    try {
      settings = await getBusinessSettings();
    } catch (e) {
      settingsError = e instanceof Error ? e.message : "Invalid settings.";
    }
    const limits: Record<string, { min: string; max: string | null } | { error: string }> = {};
    for (const coin of ["usdc", "usdt"] as const) {
      try {
        const l = settings?.paymentLimits[coin] ?? limitsMod.getPaymentLimits(coin);
        limits[coin] = { min: l.min, max: l.max };
      } catch (e) {
        limits[coin] = { error: e instanceof Error ? e.message : "Invalid limits." };
      }
    }
    const [webhook, failedWebhooks] = await Promise.all([
      context.supabase
        .from("stables_webhook_events")
        .select("received_at, event_type, processed_at, process_error")
        .order("received_at", { ascending: false })
        .limit(1),
      context.supabase
        .from("stables_webhook_events")
        .select("event_id", { count: "exact", head: true })
        .not("process_error", "is", null)
        .is("processed_at", null),
    ]);
    return {
      stables: {
        configured: stables.configured,
        environment: stables.configured ? stables.environment : null,
        webhookSecretSet: Boolean(getStablesWebhookSecret()),
        lastWebhook: webhook.error ? null : (webhook.data?.[0] ?? null),
        unprocessedFailures: failedWebhooks.error ? null : (failedWebhooks.count ?? 0),
      },
      jupiter: {
        configured: Boolean(process.env["JUPITER_API_KEY"]),
        referralAccountSet: Boolean(process.env["JUPITER_REFERRAL_ACCOUNT"]?.trim()),
      },
      solana: { customRpc: Boolean(process.env["SOLANA_RPC_URL"]) },
      // Full mode report for admins (the public one hides configuration details).
      mode: (await import("@/lib/app-mode.server")).currentMode(),
      settings: settings
        ? {
            ok: true as const,
            feeBps: settings.conversionFeeBps,
            revenueWalletSet: Boolean(settings.revenueWallet),
            enabledCurrencies: settings.enabledCurrencies,
          }
        : { ok: false as const, error: settingsError },
      limits,
      payoutEstimateMinutes: Number(process.env["PAYOUT_ESTIMATE_MINUTES"] || 60),
      checkedAt: new Date().toISOString(),
    };
  });

/**
 * Revenue reconciliation (C10): fees expected vs fees received (per payment,
 * exact), the append-only fee ledger vs the payment records, and the revenue
 * wallet's live on-chain balance (informative: the owner may move funds). Read
 * only; the wallet address itself is not returned.
 */
export const getRevenueReconciliation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const [payments, ledger] = await Promise.all([
      supabase
        .from("payments")
        .select(REVENUE_COLUMNS)
        .gt("platform_fee_minor", 0)
        .limit(REVENUE_SCAN_LIMIT),
      supabase
        .from("payment_fee_ledger")
        .select("payment_id, entry_type, amount_minor, currency")
        .eq("category", "lamportpay_fee")
        .limit(REVENUE_SCAN_LIMIT * 2),
    ]);
    if (payments.error) throw new Error(payments.error.message);
    if (ledger.error) throw new Error(ledger.error.message);

    const { getBusinessSettings } = await import("@/lib/business-settings.server");
    const { readWalletHoldings } = await import("@/lib/solana-balances.server");
    const { reconcileRevenue } = await import("@/lib/payments/revenue-reconciliation");

    let onChain:
      | { status: "ok"; readAt: string; balances: Record<string, bigint> }
      | { status: "not_configured" }
      | { status: "unavailable"; reason: string } = { status: "not_configured" };
    let wallet: string | null = null;
    try {
      wallet = (await getBusinessSettings()).revenueWallet;
    } catch (e) {
      onChain = {
        status: "unavailable",
        reason: e instanceof Error ? e.message : "Settings are invalid.",
      };
    }
    if (wallet) {
      const h = await readWalletHoldings(wallet);
      onChain =
        h.status === "ok"
          ? { status: "ok", readAt: h.readAt, balances: { ...h.tokens } }
          : { status: "unavailable", reason: "The revenue wallet's balance could not be read." };
    }

    const rows = (payments.data ?? []) as RevenueRow[];
    const result = reconcileRevenue(
      rows.map((r) => ({
        id: r.id,
        currency: r.deposit_currency ?? r.source_currency,
        feeMinor: BigInt(r.platform_fee_minor ?? 0),
        receivedMinor:
          r.platform_fee_received_minor === null ? null : BigInt(r.platform_fee_received_minor),
        fundingVerified: Boolean(r.funding_verified_at),
      })),
      (ledger.data ?? []).map((l) => ({
        paymentId: l.payment_id,
        entryType: l.entry_type as "expected" | "received",
        amountMinor: BigInt(l.amount_minor),
        currency: l.currency,
      })),
      onChain,
    );
    return {
      ...result,
      checkedAt: new Date().toISOString(),
      partial: rows.length >= REVENUE_SCAN_LIMIT,
    };
  });

/**
 * Customer identities for admin: wallet ↔ LamportPay user ↔ Stables customer.
 * Read through the admin's own session (RLS admin policies). No names, emails,
 * keys or KYC documents: only references, statuses and times.
 */
export const getCustomerIdentities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const [wallets, customers, events] = await Promise.all([
      supabase
        .from("user_wallets")
        .select("user_id, address, linked_at, last_authenticated_at")
        .order("linked_at", { ascending: false })
        .limit(500),
      supabase
        .from("stables_customers")
        .select(
          "user_id, stables_customer_id, verification_status, base_payout_status, verified_at, updated_at",
        )
        .limit(500),
      supabase
        .from("identity_events")
        .select("id, user_id, event, wallet_address, detail, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (wallets.error || customers.error || events.error) {
      throw new Error("Could not load customer identities.");
    }
    const { kycStateOf } = await import("@/lib/identity/kyc-state");

    type Entry = {
      userId: string;
      wallets: { address: string; linkedAt: string; lastAuthenticatedAt: string | null }[];
      stablesCustomerId: string | null;
      kycState: ReturnType<typeof kycStateOf>;
      verificationStatus: string | null;
      basePayoutStatus: string | null;
      verifiedAt: string | null;
      updatedAt: string | null;
    };
    const byUser = new Map<string, Entry>();
    const entry = (userId: string): Entry => {
      let e = byUser.get(userId);
      if (!e) {
        e = {
          userId,
          wallets: [],
          stablesCustomerId: null,
          kycState: "not_registered",
          verificationStatus: null,
          basePayoutStatus: null,
          verifiedAt: null,
          updatedAt: null,
        };
        byUser.set(userId, e);
      }
      return e;
    };
    for (const w of wallets.data ?? []) {
      entry(w.user_id).wallets.push({
        address: w.address,
        linkedAt: w.linked_at,
        lastAuthenticatedAt: w.last_authenticated_at,
      });
    }
    for (const c of customers.data ?? []) {
      const e = entry(c.user_id);
      e.stablesCustomerId = c.stables_customer_id;
      e.verificationStatus = c.verification_status;
      e.basePayoutStatus = c.base_payout_status;
      e.verifiedAt = c.verified_at;
      e.updatedAt = c.updated_at;
      e.kycState = kycStateOf({
        registered: true,
        verificationStatus: c.verification_status,
        basePayoutStatus: c.base_payout_status,
      });
    }
    const rows = [...byUser.values()].sort((a, b) =>
      (b.updatedAt ?? b.wallets[0]?.linkedAt ?? "").localeCompare(
        a.updatedAt ?? a.wallets[0]?.linkedAt ?? "",
      ),
    );
    return {
      customers: rows,
      events: (events.data ?? []).map((e) => ({
        id: e.id,
        userId: e.user_id,
        event: e.event,
        walletAddress: e.wallet_address,
        detail: JSON.stringify(e.detail ?? {}),
        createdAt: e.created_at,
      })),
    };
  });
