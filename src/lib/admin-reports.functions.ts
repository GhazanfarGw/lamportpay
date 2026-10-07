/**
 * Admin exports and the daily reconciliation report. Read-only, admin-only,
 * from authoritative records (payments, fee ledger, cases, stored webhooks).
 * Every export is written to the admin audit log.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActions } from "./admin.audit.server";
import { toMajor } from "./money";
import { toCsv, utcDayBounds } from "./payments/csv";

type AdminContext = {
  supabase: { rpc: (fn: "has_role", args: { _user_id: string; _role: "admin" }) => unknown };
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

const MAX_EXPORT_DAYS = 31;
const MAX_EXPORT_ROWS = 5000;

const EXPORT_COLUMNS =
  "id, created_at, updated_at, status, user_id, payer_wallet, source_currency, source_amount_minor, platform_fee_minor, destination_currency, destination_country, destination_amount_minor, actual_payout_minor, exchange_rate, transfer_id, deposit_amount_minor, funding_signature, funding_verified_at, failure_reason";

type ExportRow = {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  user_id: string;
  payer_wallet: string | null;
  source_currency: string;
  source_amount_minor: number;
  platform_fee_minor: number | null;
  destination_currency: string;
  destination_country: string;
  destination_amount_minor: number | null;
  actual_payout_minor: number | null;
  exchange_rate: number | string | null;
  transfer_id: string | null;
  deposit_amount_minor: number | null;
  funding_signature: string | null;
  funding_verified_at: string | null;
  failure_reason: string | null;
};

function major(minor: number | null, currency: string): string {
  if (minor === null) return "";
  try {
    return toMajor(BigInt(minor), currency);
  } catch {
    return String(minor);
  }
}

/**
 * Payments created between two UTC dates (inclusive, at most 31 days) as CSV.
 * Bank details are never exported (only the masked summary exists anyway).
 */
export const exportPaymentsCsvAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ from: z.string(), to: z.string() }).strict().parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const start = utcDayBounds(data.from).start;
    const end = utcDayBounds(data.to).end;
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    if (days <= 0) throw new Error("The end date is before the start date.");
    if (days > MAX_EXPORT_DAYS) throw new Error(`Export at most ${MAX_EXPORT_DAYS} days at once.`);

    const { supabase } = context;
    const [payments, cases] = await Promise.all([
      supabase
        .from("payments")
        .select(EXPORT_COLUMNS)
        .gte("created_at", start)
        .lt("created_at", end)
        .order("created_at", { ascending: true })
        .limit(MAX_EXPORT_ROWS + 1),
      supabase.from("payment_cases").select("payment_id, kind, status").neq("status", "closed"),
    ]);
    if (payments.error) throw new Error(payments.error.message);
    if (cases.error) throw new Error(cases.error.message);
    const rows = (payments.data ?? []) as unknown as ExportRow[];
    if (rows.length > MAX_EXPORT_ROWS) {
      throw new Error(`More than ${MAX_EXPORT_ROWS} payments; export a shorter period.`);
    }
    const openCase = new Map(
      (cases.data ?? []).map((c) => [c.payment_id, `${c.kind}/${c.status}`] as const),
    );
    const csv = toCsv(
      [
        "payment_id",
        "created_at_utc",
        "updated_at_utc",
        "status",
        "user_id",
        "payer_wallet",
        "coin",
        "amount_to_stables",
        "lamportpay_fee",
        "payout_currency",
        "payout_country",
        "quoted_payout",
        "actual_payout",
        "exchange_rate",
        "stables_transfer_id",
        "deposit_amount",
        "funding_signature",
        "funding_verified_at_utc",
        "open_case",
        "failure_reason",
      ],
      rows.map((r) => [
        r.id,
        r.created_at,
        r.updated_at,
        r.status,
        r.user_id,
        r.payer_wallet,
        r.source_currency.toUpperCase(),
        major(r.source_amount_minor, r.source_currency),
        major(r.platform_fee_minor, r.source_currency),
        r.destination_currency.toUpperCase(),
        r.destination_country,
        major(r.destination_amount_minor, r.destination_currency),
        major(r.actual_payout_minor, r.destination_currency),
        r.exchange_rate === null ? "" : String(r.exchange_rate),
        r.transfer_id,
        major(r.deposit_amount_minor, r.source_currency),
        r.funding_signature,
        r.funding_verified_at,
        openCase.get(r.id) ?? "",
        r.failure_reason,
      ]),
    );
    await logAdminActions(
      supabase,
      { id: context.userId, email: (context.claims as { email?: string } | null)?.email ?? null },
      [
        {
          entityType: "business_settings",
          entityReference: "payments_export",
          action: "payments_exported",
          note: `${data.from}..${data.to}, ${rows.length} rows`,
        },
      ],
    );
    return { filename: `lamportpay-payments-${data.from}_${data.to}.csv`, csv, rows: rows.length };
  });

type DayPayment = {
  id: string;
  status: string;
  source_currency: string;
  source_amount_minor: number;
  platform_fee_minor: number | null;
  destination_currency: string;
  destination_amount_minor: number | null;
  actual_payout_minor: number | null;
  funding_signature: string | null;
};

/**
 * Daily reconciliation report for one UTC day: payments created that day by
 * status, amounts sent per coin, LamportPay fees (fee ledger vs payments),
 * payouts per currency, plus what is open right now (cases, failed webhooks,
 * transfers still waiting on Stables).
 */
export const getDailyReportAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ date: z.string() }).strict().parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { start, end } = utcDayBounds(data.date);
    const { supabase } = context;
    const [payments, ledger, cases, webhookErrors, waiting] = await Promise.all([
      supabase
        .from("payments")
        .select(
          "id, status, source_currency, source_amount_minor, platform_fee_minor, destination_currency, destination_amount_minor, actual_payout_minor, funding_signature",
        )
        .gte("created_at", start)
        .lt("created_at", end)
        .limit(MAX_EXPORT_ROWS),
      supabase
        .from("payment_fee_ledger")
        .select("payment_id, category, entry_type, amount_minor, currency")
        .gte("created_at", start)
        .lt("created_at", end)
        .limit(MAX_EXPORT_ROWS * 4),
      supabase.from("payment_cases").select("kind, status").neq("status", "closed"),
      supabase
        .from("stables_webhook_events")
        .select("event_id", { count: "exact", head: true })
        .is("processed_at", null)
        .not("process_error", "is", null),
      supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .in("status", [
          "FUNDS_COLLECTED",
          "IN_PROGRESS",
          "PAYMENT_SUBMITTED",
          "PAYMENT_PROCESSED",
          "COMPLIANCE_HOLD",
        ]),
    ]);
    for (const r of [payments, ledger, cases, webhookErrors, waiting]) {
      if (r.error) throw new Error(r.error.message);
    }
    const rows = (payments.data ?? []) as DayPayment[];
    const byStatus: Record<string, number> = {};
    const sentByCoin: Record<string, bigint> = {};
    const feesOnPayments: Record<string, bigint> = {};
    const payoutsByCurrency: Record<string, { quoted: bigint; actual: bigint; completed: number }> =
      {};
    for (const p of rows) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      if (p.funding_signature || p.status === "COMPLETED") {
        sentByCoin[p.source_currency] =
          (sentByCoin[p.source_currency] ?? 0n) + BigInt(p.source_amount_minor);
        feesOnPayments[p.source_currency] =
          (feesOnPayments[p.source_currency] ?? 0n) + BigInt(p.platform_fee_minor ?? 0);
      }
      if (p.status === "COMPLETED") {
        const c = (payoutsByCurrency[p.destination_currency] ??= {
          quoted: 0n,
          actual: 0n,
          completed: 0,
        });
        c.completed += 1;
        c.quoted += BigInt(p.destination_amount_minor ?? 0);
        c.actual += BigInt(p.actual_payout_minor ?? 0);
      }
    }
    const ledgerTotals: Record<string, bigint> = {};
    for (const e of (ledger.data ?? []) as {
      category: string;
      entry_type: string;
      amount_minor: number;
      currency: string;
    }[]) {
      const key = `${e.category}/${e.entry_type}/${e.currency}`;
      ledgerTotals[key] = (ledgerTotals[key] ?? 0n) + BigInt(e.amount_minor);
    }
    const fmt = (map: Record<string, bigint>) =>
      Object.fromEntries(
        Object.entries(map).map(([k, v]) => [k, toMajor(v, k.split("/").at(-1) ?? "usdc")]),
      );
    const openCases: Record<string, number> = {};
    for (const c of cases.data ?? []) openCases[c.kind] = (openCases[c.kind] ?? 0) + 1;

    return {
      date: data.date,
      created: rows.length,
      byStatus,
      sentByCoin: fmt(sentByCoin),
      feesOnPayments: fmt(feesOnPayments),
      feeLedger: fmt(ledgerTotals),
      payouts: Object.fromEntries(
        Object.entries(payoutsByCurrency).map(([cur, v]) => [
          cur.toUpperCase(),
          {
            completed: v.completed,
            quoted: toMajor(v.quoted, cur),
            actual: toMajor(v.actual, cur),
          },
        ]),
      ),
      openNow: {
        cases: openCases,
        webhookErrors: webhookErrors.count ?? 0,
        waitingOnStables: waiting.count ?? 0,
      },
      notes: [
        "Amounts are from LamportPay's records (payments and the append-only fee ledger).",
        "actual payout stays 0 until Stables reports actual_payout (open question #55).",
      ],
    };
  });
