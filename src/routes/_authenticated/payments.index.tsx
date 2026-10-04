import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";

import { AppLayout } from "@/components/app/AppLayout";
import { paymentApi } from "@/lib/payments/api-client";
import type { PaymentListItem } from "@/lib/payments/view";

export const Route = createFileRoute("/_authenticated/payments/")({
  head: () => ({
    meta: [
      { title: "Payment history | LamportPay" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PaymentHistoryPage,
});

const STATUS_TEXT: Record<string, string> = {
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  KYC_REJECTED: "Verification rejected",
};

function PaymentHistoryPage() {
  const payments = useQuery({
    queryKey: ["payments"],
    queryFn: async () => (await paymentApi<PaymentListItem[]>("/api/payments")).data,
  });

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-5 py-14 md:py-20 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Payment history</h1>
            <p className="text-muted-foreground mt-2">
              Every payment you started. Completed payments have a receipt.
            </p>
          </div>
          <Link
            to="/pay"
            search={{}}
            className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 font-semibold hover:opacity-90"
          >
            New payment <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {payments.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {payments.error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
            {(payments.error as Error).message}
          </div>
        )}
        {payments.data && payments.data.length === 0 && (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        )}

        {payments.data && payments.data.length > 0 && (
          <div className="rounded-3xl border border-border/60 bg-card divide-y divide-border/50">
            {payments.data.map((p) => (
              <div key={p.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="font-semibold">
                    {p.source.amount} {p.source.currency.toUpperCase()} →{" "}
                    {p.actualPayout
                      ? `${p.actualPayout.amount} ${p.actualPayout.currency.toUpperCase()}`
                      : `${p.destination.amount ?? "—"} ${p.destination.currency.toUpperCase()}`}
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {p.destination.country}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(p.createdAt).toLocaleString()}
                    {p.accountHolder && ` · to ${p.accountHolder}`} ·{" "}
                    <span className="font-mono">{p.id.slice(0, 8)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-semibold px-3 py-1 rounded-full ${
                      p.status === "COMPLETED"
                        ? "bg-[color:var(--success)]/15 text-[color:var(--success)]"
                        : p.terminal
                          ? "bg-destructive/10 text-destructive"
                          : "bg-primary/10 text-primary"
                    }`}
                  >
                    {STATUS_TEXT[p.status] ?? "In progress"}
                  </span>
                  {p.status === "COMPLETED" ? (
                    <Link
                      to="/payments/$id"
                      params={{ id: p.id }}
                      className="text-sm font-semibold text-primary hover:underline"
                    >
                      Receipt
                    </Link>
                  ) : (
                    <Link
                      to="/pay"
                      search={{ payment: p.id }}
                      className="text-sm font-semibold text-primary hover:underline"
                    >
                      {p.terminal ? "Details" : "Continue"}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
