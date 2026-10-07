import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, RefreshCw, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { AdminStablesPaymentRow, AdminUnmatchedTravelRule } from "@/lib/admin.constants";
import { getStablesPaymentsAdmin } from "@/lib/admin.functions";
import { formatMinor } from "@/lib/money";
import { travelRuleStatus, type TravelRuleStatus } from "@/lib/payments/view";

const TRAVEL_RULE_LABELS: Record<TravelRuleStatus, string> = {
  required: "Wallet verification pending",
  expired: "Verification link expired",
  resolved: "Hold lifted",
  closed: "Ended unverified",
};

function fmtDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function amount(minor: number | null, currency: string) {
  return minor === null ? "—" : `${formatMinor(BigInt(minor), currency)} ${currency.toUpperCase()}`;
}

function host(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function CopyLink({ url }: { url: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        void navigator.clipboard?.writeText(url);
        toast.success("Verification link copied");
      }}
    >
      <Copy className="w-3.5 h-3.5 mr-2" />
      Copy link ({host(url) ?? "link"})
    </Button>
  );
}

function TravelRulePill({ status }: { status: TravelRuleStatus }) {
  const tone =
    status === "resolved"
      ? "bg-primary/10 text-primary border-primary/20"
      : status === "required"
        ? "bg-[color:var(--warning)]/20 text-foreground border-[color:var(--warning)]/40"
        : "bg-destructive/10 text-destructive border-destructive/20";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      {TRAVEL_RULE_LABELS[status]}
    </span>
  );
}

function StatusText({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/60 bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
      {value.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

function OpenTravelRule({ row }: { row: AdminStablesPaymentRow }) {
  const status = travelRuleStatus(row)!;
  return (
    <div className="rounded-2xl border border-border/60 bg-background p-4 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link
            to="/admin/payments/$id"
            params={{ id: row.id }}
            className="font-mono text-xs text-primary hover:underline"
          >
            {row.id}
          </Link>
          <div className="text-xs text-muted-foreground">
            {amount(row.source_amount_minor, row.source_currency)} →{" "}
            {row.destination_currency.toUpperCase()} · {row.destination_country}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <StatusText value={row.status} />
          <TravelRulePill status={status} />
        </div>
      </div>
      <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Stables reference</dt>
        <dd className="font-mono break-all">{row.travel_rule_reference ?? "—"}</dd>
        <dt className="text-muted-foreground">Requested</dt>
        <dd>{fmtDate(row.travel_rule_requested_at)}</dd>
        <dt className="text-muted-foreground">Link expires</dt>
        <dd>{fmtDate(row.travel_rule_expires_at)}</dd>
        <dt className="text-muted-foreground">Sending wallet</dt>
        <dd className="font-mono break-all">{row.payer_wallet ?? "not recorded"}</dd>
        <dt className="text-muted-foreground">User</dt>
        <dd className="font-mono break-all">{row.user_id}</dd>
      </dl>
      {row.travel_rule_verification_url ? (
        status === "required" && <CopyLink url={row.travel_rule_verification_url} />
      ) : (
        <p className="text-xs text-destructive">
          Stables sent no usable https link; ask Stables for one.
        </p>
      )}
    </div>
  );
}

function UnmatchedTravelRule({ row }: { row: AdminUnmatchedTravelRule }) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-background p-4 text-xs space-y-1">
      <div className="font-mono break-all text-sm">{row.reference ?? "(no reference)"}</div>
      <div className="text-muted-foreground">
        Received {fmtDate(row.receivedAt)} · link expires {fmtDate(row.expiresAt)} · event{" "}
        <span className="font-mono">{row.eventId}</span>
      </div>
      {row.note && <div className="text-muted-foreground">{row.note}</div>}
    </div>
  );
}

type View =
  | "all"
  | "attention"
  | "critical"
  | "case"
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "compliance"
  | "today";

const VIEW_LABELS: Record<View, string> = {
  all: "All payments",
  attention: "Needs attention",
  critical: "Critical only",
  case: "Open case / refund",
  pending: "Pending (before deposit)",
  processing: "Processing at Stables",
  completed: "Completed",
  failed: "Failed / cancelled / expired",
  compliance: "Compliance review",
  today: "Today",
};

const PENDING = new Set([
  "PAYMENT_CREATED",
  "KYC_PENDING",
  "KYC_APPROVED",
  "QUOTED",
  "CREATED",
  "AWAITING_FUNDS_COLLECTION",
]);
const PROCESSING = new Set([
  "FUNDS_COLLECTED",
  "IN_PROGRESS",
  "PAYMENT_SUBMITTED",
  "PAYMENT_PROCESSED",
]);
const ENDED = new Set(["FAILED", "CANCELLED", "EXPIRED", "KYC_REJECTED"]);

function matchesView(row: AdminStablesPaymentRow, view: View): boolean {
  const alerts = row.attention ?? [];
  switch (view) {
    case "all":
      return true;
    case "attention":
      return alerts.some((a) => a.severity !== "info");
    case "critical":
      return alerts.some((a) => a.severity === "critical");
    case "case":
      return Boolean(row.open_case_status) || alerts.some((a) => a.code === "ended_after_funds");
    case "pending":
      return PENDING.has(row.status);
    case "processing":
      return PROCESSING.has(row.status);
    case "completed":
      return row.status === "COMPLETED";
    case "failed":
      return ENDED.has(row.status);
    case "compliance":
      return row.status === "COMPLIANCE_HOLD";
    case "today":
      return new Date(row.created_at).toDateString() === new Date().toDateString();
  }
}

function AttentionPill({
  severity,
  label,
}: {
  severity: "info" | "warning" | "critical";
  label: string;
}) {
  const tone =
    severity === "critical"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : severity === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-border/60 bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

/** Live Stables payments, with Travel Rule wallet-verification holds first. */
export function StablesPaymentsAdmin() {
  const fetchPayments = useServerFn(getStablesPaymentsAdmin);
  const query = useQuery({
    queryKey: ["admin-stables-payments"],
    queryFn: () => fetchPayments(),
    // Statuses follow Stables; the server re-reads open transfers on each load.
    refetchInterval: 15_000,
  });
  const data = query.data;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState<View>("all");
  if (data && !data.isAdmin) return null;

  const statuses = [...new Set((data?.payments ?? []).map((p) => p.status))].sort();
  const needle = search.trim().toLowerCase();
  const attentionCount = (data?.payments ?? []).filter((p) =>
    (p.attention ?? []).some((a) => a.severity !== "info"),
  ).length;
  const visible = (data?.payments ?? []).filter(
    (row) =>
      matchesView(row, view) &&
      (status === "all" || row.status === status) &&
      (!needle ||
        [row.id, row.transfer_id, row.user_id, row.payer_wallet, row.destination_country]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle))),
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Search payments"
            placeholder="Search ID, transfer, user, wallet, country"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-72 max-w-full rounded-md border border-border bg-background px-3 text-sm"
          />
          <select
            aria-label="Filter by operations view"
            value={view}
            onChange={(e) => setView(e.target.value as View)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            {(Object.keys(VIEW_LABELS) as View[]).map((v) => (
              <option key={v} value={v}>
                {VIEW_LABELS[v]}
                {v === "attention" && data?.isAdmin ? ` (${attentionCount})` : ""}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="all">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-2 ${query.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {query.isLoading && <p className="text-sm text-muted-foreground">Loading payments…</p>}
      {query.isError && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          Could not load Stables payments. {(query.error as Error).message}
        </div>
      )}

      {data?.isAdmin && (
        <>
          <div className="rounded-2xl border-2 border-[color:var(--warning)]/60 bg-card p-5 space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" />
              Travel Rule: waiting on wallet verification ({data.travelRuleOpen.length})
            </h3>
            <p className="text-xs text-muted-foreground">
              Stables holds these transfers until the user proves they own the self-custody wallet
              the USDC came from. Stables sends no "verified" event: a hold counts as lifted once
              the transfer moves on. Users see the step on their payment page; share the link only
              with the payment's owner.
            </p>
            {data.travelRuleOpen.length === 0 && (
              <p className="text-sm text-muted-foreground">None open.</p>
            )}
            {data.travelRuleOpen.map((row) => (
              <OpenTravelRule key={row.id} row={row} />
            ))}

            {data.travelRuleUnmatched.length > 0 && (
              <>
                <h4 className="font-semibold text-sm pt-2">
                  Requests with no matching payment ({data.travelRuleUnmatched.length})
                </h4>
                <p className="text-xs text-muted-foreground">
                  The Stables reference matched no transfer ID or deposit transaction. They are
                  retried automatically; if one stays here, ask Stables which transfer it belongs
                  to.
                </p>
                {data.travelRuleUnmatched.map((row) => (
                  <UnmatchedTravelRule key={row.eventId} row={row} />
                ))}
              </>
            )}
          </div>

          <div className="rounded-2xl border border-border/60 bg-background divide-y divide-border/50">
            <div className="p-3 text-xs text-muted-foreground">
              Latest {data.payments.length} payments · showing {visible.length}
            </div>
            {visible.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {data.payments.length === 0 ? "No payments yet." : "No payments match the filter."}
              </p>
            )}
            {visible.map((row) => {
              const rule = travelRuleStatus(row);
              return (
                <div
                  key={row.id}
                  className="p-3 text-xs flex flex-wrap items-center justify-between gap-2"
                >
                  <div>
                    <Link
                      to="/admin/payments/$id"
                      params={{ id: row.id }}
                      className="font-mono text-primary hover:underline"
                    >
                      {row.id}
                    </Link>
                    <div className="text-muted-foreground">
                      {fmtDate(row.created_at)} ·{" "}
                      {amount(row.source_amount_minor, row.source_currency)} →{" "}
                      {amount(row.destination_amount_minor, row.destination_currency)} ·{" "}
                      {row.destination_country}
                      {row.failure_reason && ` · ${row.failure_reason}`}
                    </div>
                    {row.transfer_id && (
                      <div className="text-muted-foreground">
                        Transfer <span className="font-mono">{row.transfer_id}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusText value={row.status} />
                    {rule && <TravelRulePill status={rule} />}
                    {(row.attention ?? [])
                      .filter((a) => a.code !== "case_open")
                      .map((a) => (
                        <AttentionPill key={a.code} severity={a.severity} label={a.label} />
                      ))}
                    {row.open_case_status && (
                      <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                        Case: {row.open_case_status.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
