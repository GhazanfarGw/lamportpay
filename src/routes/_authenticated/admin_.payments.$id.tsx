import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, CheckCircle2, Circle, Clock } from "lucide-react";

import { SiteLayout } from "@/components/site/Layout";
import { Button } from "@/components/ui/button";
import { STATUS_LABELS, ENTITY_LABELS } from "@/lib/admin.constants";
import { getPaymentDetail } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin_/payments/$id")({
  head: () => ({
    meta: [
      { title: "Mock payment tracking detail | LamportPay" },
      {
        name: "description",
        content:
          "Internal LamportPay demo view showing the full mock tracking timeline for a demo payment: quote, partner reference, Solana hash and settlement steps.",
      },
      { property: "og:title", content: "Mock payment tracking detail | LamportPay" },
      {
        property: "og:description",
        content:
          "Full mock tracking timeline for a LamportPay demo payment, including quote, partner reference and settlement steps.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PaymentDetailPage,
});

function fmtDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/50 last:border-0">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm text-right break-all">{value}</span>
    </div>
  );
}

function TimelineStep({
  title,
  detail,
  timestamp,
  state,
}: {
  title: string;
  detail: string;
  timestamp: string | null;
  state: "done" | "active" | "pending";
}) {
  const Icon = state === "done" ? CheckCircle2 : state === "active" ? Clock : Circle;
  return (
    <li className="relative pl-8 pb-6 last:pb-0">
      <span className="absolute left-0 top-0.5">
        <Icon
          className={`w-5 h-5 ${
            state === "done"
              ? "text-primary"
              : state === "active"
                ? "text-primary animate-pulse"
                : "text-muted-foreground/50"
          }`}
        />
      </span>
      <span className="absolute left-2.5 top-6 bottom-0 w-px bg-border/70 last:hidden" />
      <div className="font-semibold text-sm">{title}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(timestamp)}</div>
    </li>
  );
}

function PaymentDetailPage() {
  const { id } = Route.useParams();
  const fetchDetail = useServerFn(getPaymentDetail);

  const query = useQuery({
    queryKey: ["admin-payment", id],
    queryFn: () => fetchDetail({ data: { id } }),
  });

  const detail = query.data?.transfer;
  const kyc = query.data?.kyc;
  const audit = query.data?.audit ?? [];

  const paid = detail?.payment_status === "paid";
  const processing = detail?.payment_status === "processing" || paid;
  const failed = detail?.payment_status === "failed" || detail?.payment_status === "refunded";

  return (
    <SiteLayout>
      <div className="mx-auto max-w-4xl px-4 py-12 space-y-8">
        <div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin">
              <ArrowLeft className="w-3.5 h-3.5 mr-2" />
              Back to admin operations
            </Link>
          </Button>
        </div>

        {query.isLoading && (
          <div className="rounded-2xl border border-border/60 bg-card p-6 text-sm text-muted-foreground">
            Loading payment…
          </div>
        )}

        {query.isError && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm">
            {(query.error as Error).message}
          </div>
        )}

        {detail && (
          <>
            <header className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight">
                {detail.sender_name} → {detail.recipient_name}
              </h1>
              <p className="text-sm text-muted-foreground font-mono">{detail.reference}</p>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Mock tracking timeline for this demo payment. All values are demo data — no real
                funds move and no live regulated payout infrastructure partner is involved.
              </p>
            </header>

            <section className="grid md:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-border/60 bg-card p-5">
                <h2 className="font-semibold text-sm mb-3">Quote</h2>
                <Row
                  label="Send"
                  value={`${Number(detail.send_amount).toLocaleString()} ${detail.send_currency}`}
                />
                <Row
                  label="Payout"
                  value={`${Number(detail.payout_amount).toLocaleString()} ${detail.payout_currency}`}
                />
                <Row label="FX rate" value={Number(detail.fx_rate).toLocaleString()} />
                <Row
                  label="Total fee"
                  value={`${Number(detail.total_fee).toLocaleString()} ${detail.send_currency}`}
                />
                <Row label="Payout rail" value={detail.payment_rail.replace(/_/g, " ")} />
                <Row
                  label="Quote status"
                  value={STATUS_LABELS[detail.quote_status] ?? detail.quote_status}
                />
              </div>

              <div className="rounded-2xl border border-border/60 bg-card p-5">
                <h2 className="font-semibold text-sm mb-3">References</h2>
                <Row
                  label="Partner reference"
                  value={<span className="font-mono">{detail.partner_reference ?? "—"}</span>}
                />
                <Row
                  label="Solana hash"
                  value={<span className="font-mono">{detail.solana_tx_signature ?? "—"}</span>}
                />
                <Row
                  label="Payment status"
                  value={STATUS_LABELS[detail.payment_status] ?? detail.payment_status}
                />
                <Row
                  label="Identity check"
                  value={
                    kyc
                      ? `${kyc.full_name} · ${STATUS_LABELS[kyc.status] ?? kyc.status}`
                      : "Not linked"
                  }
                />
                <Row label="Operations note" value={detail.admin_note ?? "—"} />
                <Row label="Timeline note" value={detail.timeline_note ?? "—"} />
              </div>
            </section>

            <section className="rounded-2xl border border-border/60 bg-card p-5">
              <h2 className="font-semibold text-sm mb-4">Mock settlement timeline</h2>
              <ol className="relative">
                <TimelineStep
                  title="Quote created"
                  detail={`Indicative rate locked at ${Number(detail.fx_rate).toLocaleString()} ${detail.payout_currency}/${detail.send_currency}`}
                  timestamp={detail.created_at}
                  state="done"
                />
                <TimelineStep
                  title="Identity check"
                  detail={
                    kyc
                      ? `${kyc.reference} · ${STATUS_LABELS[kyc.status] ?? kyc.status}`
                      : "No mock identity check linked to this payment"
                  }
                  timestamp={kyc?.reviewed_at ?? kyc?.created_at ?? null}
                  state={kyc?.status === "approved" ? "done" : kyc ? "active" : "pending"}
                />
                <TimelineStep
                  title="Crypto funds received on Solana"
                  detail={detail.solana_tx_signature ?? "Awaiting mock on-chain transfer"}
                  timestamp={detail.funded_at}
                  state={detail.funded_at ? "done" : "pending"}
                />
                <TimelineStep
                  title="Handed to payout partner"
                  detail={detail.partner_reference ?? "Awaiting partner reference"}
                  timestamp={detail.funded_at}
                  state={processing ? "done" : "pending"}
                />
                <TimelineStep
                  title="Local currency paid out"
                  detail={
                    failed
                      ? `Payment ${STATUS_LABELS[detail.payment_status] ?? detail.payment_status}`
                      : `${Number(detail.payout_amount).toLocaleString()} ${detail.payout_currency} to ${detail.recipient_name}`
                  }
                  timestamp={detail.settled_at}
                  state={paid ? "done" : failed ? "active" : "pending"}
                />
              </ol>
            </section>

            <section className="rounded-2xl border border-border/60 bg-card p-5">
              <h2 className="font-semibold text-sm mb-3">Audit trail for this payment</h2>
              {audit.length === 0 && (
                <p className="text-sm text-muted-foreground">No admin actions recorded yet.</p>
              )}
              <ul className="space-y-2">
                {audit.map((entry) => (
                  <li
                    key={entry.id}
                    className="text-xs text-muted-foreground border-b border-border/50 pb-2 last:border-0"
                  >
                    <span className="font-semibold text-foreground">
                      {ENTITY_LABELS[entry.entity_type] ?? entry.entity_type} ·{" "}
                      {entry.action.replace(/_/g, " ")}
                    </span>
                    {entry.field && (
                      <>
                        {" "}
                        — {entry.field}: {entry.old_value ?? "—"} → {entry.new_value ?? "—"}
                      </>
                    )}
                    <div>
                      {fmtDate(entry.created_at)} · {entry.actor_email ?? "unknown admin"}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </SiteLayout>
  );
}
