import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ShieldCheck, AlertTriangle, RefreshCw, Users, ScrollText, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { AdminSignOutButton } from "@/components/site/AdminSignOutButton";
import { BusinessSettingsAdmin } from "@/components/site/BusinessSettingsAdmin";
import { SiteLayout } from "@/components/site/Layout";
import { StablesPaymentsAdmin } from "@/components/site/StablesPaymentsAdmin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ADMIN_PAYMENT_STATUSES,
  ADMIN_QUOTE_STATUSES,
  ENTITY_LABELS,
  STATUS_LABELS,
  type AdminAuditRow,
  type AdminKycRow,
  type AdminTransferRow,
  type PaymentStatus,
  type QuoteStatus,
} from "@/lib/admin.constants";
import {
  getAdminOverview,
  reviewKycSubmission,
  updateTransferStatus,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin operations console | LamportPay" },
      {
        name: "description",
        content:
          "Internal LamportPay demo console for reviewing mock identity checks and managing mock payout quote and payment statuses.",
      },
      { property: "og:title", content: "Admin operations console | LamportPay" },
      {
        property: "og:description",
        content:
          "Review mock identity checks and update mock payout quote and payment statuses in the LamportPay demo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

function StatusPill({ value }: { value: string }) {
  const tone =
    value === "approved" || value === "paid" || value === "active"
      ? "bg-primary/10 text-primary border-primary/20"
      : value === "rejected" || value === "failed" || value === "cancelled"
        ? "bg-destructive/10 text-destructive border-destructive/20"
        : "bg-muted text-muted-foreground border-border/60";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      {STATUS_LABELS[value] ?? value}
    </span>
  );
}

function fmtMoney(amount: number, currency: string) {
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

function KycCard({
  row,
  onReview,
  busy,
}: {
  row: AdminKycRow;
  onReview: (status: "approved" | "rejected", note: string) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState(row.review_note ?? "");

  return (
    <div className="rounded-2xl border border-border/60 bg-background p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">{row.full_name}</div>
          <div className="text-xs text-muted-foreground">
            {row.email} · {row.country} · {row.document_type.replace(/_/g, " ")}
          </div>
          <div className="text-[11px] font-mono text-muted-foreground mt-1">{row.reference}</div>
        </div>
        <StatusPill value={row.status} />
      </div>

      <Input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Reviewer note (optional)"
        maxLength={500}
      />

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => onReview("approved", note)}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onReview("rejected", note)}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

function TransferCard({
  row,
  onUpdate,
  busy,
}: {
  row: AdminTransferRow;
  onUpdate: (patch: {
    quoteStatus?: QuoteStatus;
    paymentStatus?: PaymentStatus;
    adminNote?: string;
  }) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState(row.admin_note ?? "");

  return (
    <div className="rounded-2xl border border-border/60 bg-background p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">
            {row.sender_name} → {row.recipient_name}
          </div>
          <div className="text-xs text-muted-foreground">
            {fmtMoney(Number(row.send_amount), row.send_currency)} →{" "}
            {fmtMoney(Number(row.payout_amount), row.payout_currency)} · FX{" "}
            {Number(row.fx_rate).toLocaleString()} · fee{" "}
            {fmtMoney(Number(row.total_fee), row.send_currency)}
          </div>
          <div className="text-[11px] font-mono text-muted-foreground mt-1">
            {row.reference} · {row.payment_rail.replace(/_/g, " ")}
          </div>
          <Link
            to="/admin/payments/$id"
            params={{ id: row.id }}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            View tracking timeline
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusPill value={row.quote_status} />
          <StatusPill value={row.payment_status} />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Quote status
          </div>
          <Select
            value={row.quote_status}
            onValueChange={(value) => onUpdate({ quoteStatus: value as QuoteStatus })}
            disabled={busy}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADMIN_QUOTE_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Payment status
          </div>
          <Select
            value={row.payment_status}
            onValueChange={(value) => onUpdate({ paymentStatus: value as PaymentStatus })}
            disabled={busy}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADMIN_PAYMENT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Operations note (optional)"
          maxLength={500}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onUpdate({ adminNote: note })}
        >
          Save note
        </Button>
      </div>
    </div>
  );
}

function AuditList({ rows }: { rows: AdminAuditRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No admin actions recorded yet.</p>;
  }
  return (
    <div className="rounded-2xl border border-border/60 bg-background divide-y divide-border/50">
      {rows.map((entry) => (
        <div key={entry.id} className="p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border/60 bg-muted px-2 py-0.5 font-semibold">
              {ENTITY_LABELS[entry.entity_type] ?? entry.entity_type}
            </span>
            <span className="font-semibold text-foreground">
              {entry.action.replace(/_/g, " ")}
            </span>
            {entry.entity_reference && (
              <span className="font-mono text-muted-foreground">{entry.entity_reference}</span>
            )}
          </div>
          {entry.field && (
            <div className="text-muted-foreground mt-1">
              {entry.field}: {entry.old_value ?? "—"} → {entry.new_value ?? "—"}
            </div>
          )}
          {entry.note && <div className="text-muted-foreground mt-1">Note: {entry.note}</div>}
          <div className="text-muted-foreground mt-1">
            {new Date(entry.created_at).toLocaleString()} · {entry.actor_email ?? "unknown admin"}
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminPage() {
  const queryClient = useQueryClient();
  const fetchOverview = useServerFn(getAdminOverview);
  const reviewKyc = useServerFn(reviewKycSubmission);
  const updateTransfer = useServerFn(updateTransferStatus);

  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => fetchOverview(),
  });

  const kycMutation = useMutation({
    mutationFn: (input: {
      id: string;
      status: "approved" | "rejected";
      reviewNote?: string;
    }) => reviewKyc({ data: input }),
    onSuccess: (row) => {
      toast.success(`Identity check ${STATUS_LABELS[row.status]?.toLowerCase()}`);
      void queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const transferMutation = useMutation({
    mutationFn: (input: {
      id: string;
      quoteStatus?: QuoteStatus;
      paymentStatus?: PaymentStatus;
      adminNote?: string;
    }) => updateTransfer({ data: input }),
    onSuccess: () => {
      toast.success("Transfer updated");
      void queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = overview.data;

  return (
    <SiteLayout>
      <div className="mx-auto max-w-5xl px-4 py-12 space-y-8">
        <header className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              Internal demo console
            </div>
            <AdminSignOutButton />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Admin operations</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Review mock identity checks and manage mock quote and payment statuses. All records
            here are demo data — no real funds, no real identity documents, and no live payout
            with a regulated payout infrastructure partner.
          </p>
        </header>

        {overview.isLoading && (
          <div className="rounded-2xl border border-border/60 bg-card p-6 text-sm text-muted-foreground">
            Loading console…
          </div>
        )}

        {overview.isError && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm">
            Could not load the console. {(overview.error as Error).message}
          </div>
        )}

        {data && !data.isAdmin && (
          <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <AlertTriangle className="w-4 h-4 text-primary" />
              Admin role required
            </div>
            <p className="text-sm text-muted-foreground">
              Your account is signed in but does not have the admin role, so no records are
              visible. Admin roles are granted directly in the backend database — contact an
              existing operator to have your account added.
            </p>
          </div>
        )}

        {data?.isAdmin && (
          <>
            <BusinessSettingsAdmin />
            <StablesPaymentsAdmin />

            <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
              <h2 className="text-lg font-semibold">Mock identity checks</h2>
              <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/roles">
                  <Users className="w-3.5 h-3.5 mr-2" />
                  Manage roles
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void overview.refetch()}
                disabled={overview.isFetching}
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 mr-2 ${overview.isFetching ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              {data.kyc.length === 0 && (
                <div className="text-sm text-muted-foreground">No submissions yet.</div>
              )}
              {data.kyc.map((row) => (
                <KycCard
                  key={row.id}
                  row={row}
                  busy={kycMutation.isPending}
                  onReview={(status, note) =>
                    kycMutation.mutate({ id: row.id, status, reviewNote: note })
                  }
                />
              ))}
            </div>

            <h2 className="text-lg font-semibold pt-4">Mock quotes and payments</h2>
            <div className="space-y-3">
              {data.transfers.length === 0 && (
                <div className="text-sm text-muted-foreground">No transfers yet.</div>
              )}
              {data.transfers.map((row) => (
                <TransferCard
                  key={row.id}
                  row={row}
                  busy={transferMutation.isPending}
                  onUpdate={(patch) => transferMutation.mutate({ id: row.id, ...patch })}
                />
              ))}
            </div>

            <h2 className="text-lg font-semibold pt-4 flex items-center gap-2">
              <ScrollText className="w-4 h-4 text-primary" />
              Audit log
            </h2>
            <p className="text-sm text-muted-foreground">
              Every identity-check decision and every quote or payment status change, with the
              timestamp and the admin who made it.
            </p>
            <AuditList rows={data.audit} />
          </>
        )}
      </div>
    </SiteLayout>
  );
}
