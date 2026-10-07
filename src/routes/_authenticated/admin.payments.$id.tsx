import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft, FlaskConical } from "lucide-react";
import { toast } from "sonner";

import { AdminPage, ConfirmButton } from "@/components/admin/AdminShell";
import { PaymentCasePanel } from "@/components/admin/PaymentCasePanel";
import { PaymentReceipt } from "@/components/site/PaymentReceipt";
import { Button } from "@/components/ui/button";
import { formatMinor } from "@/lib/money";
import { getStablesPaymentDetailAdmin, simulateSandboxDepositAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/payments/$id")({
  head: () => ({
    meta: [
      { title: "Payment | LamportPay Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminStablesPaymentPage,
});

const FUNDABLE = new Set(["CREATED", "AWAITING_FUNDS_COLLECTION"]);

/** One live Stables payment: the user's receipt plus operations details. */
function AdminStablesPaymentPage() {
  const { id } = Route.useParams();
  const fetchDetail = useServerFn(getStablesPaymentDetailAdmin);
  const simulate = useServerFn(simulateSandboxDepositAdmin);

  const query = useQuery({
    queryKey: ["admin-stables-payment", id],
    queryFn: () => fetchDetail({ data: { id } }),
    refetchInterval: (q) => (q.state.data?.payment.terminal ? false : 5000),
  });
  const deposit = useMutation({
    mutationFn: () => simulate({ data: { id } }),
    onSuccess: (result) => {
      toast.success(
        `Deposit simulated (${result.deposit_status}). The status now follows Stables automatically.`,
      );
      void query.refetch();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = query.data;
  const p = data?.payment;

  return (
    <AdminPage
      title="Payment detail"
      crumbs={[{ label: "Payments", to: "/admin/payments" }, { label: id.slice(0, 8) }]}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/payments">
            <ArrowLeft className="w-3.5 h-3.5 mr-2" />
            All payments
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        {query.isLoading && <p className="text-sm text-muted-foreground">Loading payment…</p>}
        {query.isError && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm">
            {(query.error as Error).message}
          </div>
        )}

        {data && p && (
          <>
            <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-3">
              <h1 className="text-xl font-semibold">
                Stables payment · {p.status.replace(/_/g, " ").toLowerCase()}
              </h1>
              <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">User</dt>
                <dd className="font-mono break-all">{data.userId}</dd>
                <dt className="text-muted-foreground">Payer wallet</dt>
                <dd className="font-mono break-all">{p.payerWallet ?? "—"}</dd>
                <dt className="text-muted-foreground">Deposit address</dt>
                <dd className="font-mono break-all">
                  {p.deposit
                    ? `${p.deposit.amount} ${p.deposit.currency.toUpperCase()} → ${p.deposit.address}`
                    : "—"}
                </dd>
                <dt className="text-muted-foreground">Stables environment</dt>
                <dd>{data.stablesEnvironment}</dd>
              </dl>

              {p.depositIssue && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <span>
                    Deposit mismatch: {p.depositIssue.received} {p.source.currency.toUpperCase()}{" "}
                    reached the deposit address, {p.depositIssue.expected} was expected (
                    {new Date(p.depositIssue.at).toLocaleString()}). The user was told not to send
                    again. Open an operations case below and resolve it with Stables using the
                    transfer ID.
                  </span>
                </div>
              )}

              {data.stablesEnvironment === "sandbox" && p.transferId && FUNDABLE.has(p.status) && (
                <div className="rounded-xl border border-border/60 bg-secondary/60 p-4 space-y-2">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-primary" />
                    Sandbox: simulate the deposit
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Asks Stables to act as if the exact deposit arrived for transfer{" "}
                    <span className="font-mono">{p.transferId}</span>. Refused with a live key.
                    Stables then sends the transfer webhooks.
                  </p>
                  <ConfirmButton
                    variant="default"
                    title="Simulate the deposit in the Stables sandbox?"
                    description="Stables will act as if the exact deposit arrived and send the transfer webhooks. Sandbox only."
                    confirmLabel="Simulate deposit"
                    onConfirm={() => deposit.mutate()}
                    disabled={deposit.isPending}
                  >
                    {deposit.isPending ? "Simulating…" : "Simulate deposit"}
                  </ConfirmButton>
                </div>
              )}
            </section>

            <PaymentCasePanel paymentId={id} onRechecked={() => void query.refetch()} />

            <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-3">
              <h2 className="font-semibold">Fee ledger</h2>
              {data.feeLedger.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No ledger entries yet (written when the transfer is created and when funding is
                  verified).
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground text-left">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Category</th>
                        <th className="py-1 pr-3 font-medium">Type</th>
                        <th className="py-1 pr-3 font-medium">Amount</th>
                        <th className="py-1 pr-3 font-medium">Reference</th>
                        <th className="py-1 font-medium">Recorded</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {data.feeLedger.map((e) => (
                        <tr key={`${e.category}-${e.entry_type}-${e.component}`}>
                          <td className="py-1 pr-3">
                            {e.category.replace(/_/g, " ")}
                            {e.component && ` · ${e.component.replace(/_/g, " ")}`}
                          </td>
                          <td className="py-1 pr-3">{e.entry_type}</td>
                          <td className="py-1 pr-3 tabular-nums">
                            {formatMinor(BigInt(e.amount_minor), e.currency)}{" "}
                            {e.currency.toUpperCase()}
                            {e.bps !== null && ` (${e.bps / 100}%)`}
                          </td>
                          <td className="py-1 pr-3 font-mono break-all">{e.reference ?? "—"}</td>
                          <td className="py-1">{new Date(e.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.pricingSnapshot && (
                <details>
                  <summary className="text-sm cursor-pointer">Pricing snapshot (fixed)</summary>
                  <pre className="mt-2 text-xs bg-muted/50 rounded-lg p-3 overflow-x-auto">
                    {data.pricingSnapshot}
                  </pre>
                </details>
              )}
            </section>

            <PaymentReceipt
              payment={p}
              mode="receipt"
              senderName={p.beneficiary?.account_holder_name ?? null}
              account={{
                holderName: p.beneficiary?.account_holder_name ?? null,
                bankName: p.beneficiary?.bank_name ?? null,
                kind: p.beneficiary?.account_kind ?? null,
                number: p.beneficiary?.account ?? null,
              }}
            />

            <section className="rounded-2xl border border-border/60 bg-card p-5">
              <h2 className="font-semibold text-sm mb-3">Timeline (with details)</h2>
              <ol className="space-y-2">
                {data.timeline.map((e, i) => (
                  <li key={i} className="text-xs border-b border-border/50 pb-2 last:border-0">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-semibold">
                        {e.kind.replace(/_/g, " ")}
                        {(e.from || e.to) && ` · ${e.from ?? "—"} → ${e.to ?? "—"}`}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(e.at).toLocaleString()} · {e.source}
                      </span>
                    </div>
                    {e.detail && (
                      <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                        {e.detail}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
    </AdminPage>
  );
}
