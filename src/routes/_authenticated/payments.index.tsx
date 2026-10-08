import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";

import { AppLayout } from "@/components/app/AppLayout";
import { Flag } from "@/components/app/Flag";
import { TokenIcon } from "@/components/app/TokenIcon";
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
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10 space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">History</h1>
          <Link
            to="/pay"
            search={{}}
            className="inline-flex items-center gap-1.5 rounded-full bg-[image:var(--gradient-hero)] text-white px-4 py-2 text-sm font-semibold shadow-[var(--shadow-soft)] hover:opacity-95"
          >
            <Plus className="w-4 h-4" /> New
          </Link>
        </div>

        {payments.isLoading && (
          <div className="rounded-3xl border border-border/60 bg-card divide-y divide-border/50">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 p-4">
                <span className="h-10 w-10 rounded-full bg-muted animate-pulse" />
                <span className="h-4 flex-1 rounded bg-muted animate-pulse" />
              </div>
            ))}
          </div>
        )}
        {payments.error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
            {(payments.error as Error).message}
          </div>
        )}
        {payments.data && payments.data.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border/70 bg-card/70 px-6 py-12 text-center">
            <p className="font-semibold">No payments yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Your conversions will appear here.</p>
          </div>
        )}

        {payments.data && payments.data.length > 0 && (
          <ul className="rounded-3xl border border-border/60 bg-card/90 backdrop-blur-xl shadow-[var(--shadow-soft)] divide-y divide-border/50 overflow-hidden">
            {payments.data.map((p) => {
              const amount = p.actualPayout
                ? `${p.actualPayout.amount} ${p.actualPayout.currency.toUpperCase()}`
                : `${p.destination.amount ?? "—"} ${p.destination.currency.toUpperCase()}`;
              const row = (
                <>
                  <span className="relative flex shrink-0 items-center">
                    <TokenIcon symbol={p.source.currency} size={34} />
                    <span className="-ml-2.5 mt-4 rounded-md ring-2 ring-card">
                      <Flag code={p.destination.country} size={20} />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      To {regionName(p.destination.country)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString([], {
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      · {p.source.amount} {p.source.currency.toUpperCase()}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold tabular-nums">{amount}</span>
                    <span
                      className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        p.status === "COMPLETED"
                          ? "bg-[color:var(--success)]/15 text-[color:var(--success)]"
                          : p.terminal
                            ? "bg-destructive/10 text-destructive"
                            : "bg-primary/10 text-primary"
                      }`}
                    >
                      {STATUS_TEXT[p.status] ?? "In progress"}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                </>
              );
              const cls =
                "flex items-center gap-3 px-4 py-3.5 hover:bg-secondary/60 active:bg-secondary transition-colors [-webkit-tap-highlight-color:transparent]";
              return (
                <li key={p.id}>
                  {p.status === "COMPLETED" ? (
                    <Link to="/payments/$id" params={{ id: p.id }} className={cls}>
                      {row}
                    </Link>
                  ) : (
                    <Link to="/pay" search={{ payment: p.id }} className={cls}>
                      {row}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppLayout>
  );
}

function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
