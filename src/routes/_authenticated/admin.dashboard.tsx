import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";

import {
  AdminPage,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  StatCard,
} from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { getAdminDashboard } from "@/lib/admin-ops.functions";
import { formatMinor } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard | LamportPay Admin" }] }),
  component: DashboardPage,
});

const label = (status: string) => status.replace(/_/g, " ").toLowerCase();

function DashboardPage() {
  const fetchDashboard = useServerFn(getAdminDashboard);
  const query = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => fetchDashboard(),
    refetchInterval: 30_000,
  });
  const d = query.data;

  return (
    <AdminPage
      title="Dashboard"
      description="Live figures from stored payments. Nothing here is estimated or sample data."
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-2 ${query.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      }
    >
      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState error={query.error} />}
      {d && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Payments"
              value={d.totals.payments.toLocaleString()}
              hint={d.totals.partial ? "First 5,000 counted" : "All time"}
            />
            <StatCard
              label="Completed"
              value={(d.totals.byStatus["COMPLETED"] ?? 0).toLocaleString()}
            />
            <StatCard
              label="LamportPay revenue received"
              value={`${formatMinor(BigInt(d.revenue.receivedMinor), "usdc")} USDC`}
              hint={`${formatMinor(BigInt(d.revenue.received24hMinor), "usdc")} USDC in the last 24 h`}
            />
            <StatCard
              label="Needs attention"
              value={(d.attention.openTravelRule + d.attention.feeMismatches).toLocaleString()}
              hint={`${d.attention.openTravelRule} Travel Rule holds · ${d.attention.feeMismatches} fee mismatches`}
            />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <Panel title="Payments by status">
              {Object.keys(d.totals.byStatus).length === 0 ? (
                <EmptyState>No payments yet.</EmptyState>
              ) : (
                <ul className="divide-y divide-border/50 text-sm">
                  {Object.entries(d.totals.byStatus)
                    .sort(([, a], [, b]) => b - a)
                    .map(([status, count]) => (
                      <li key={status} className="flex justify-between py-1.5">
                        <span className="capitalize">{label(status)}</span>
                        <span className="font-medium tabular-nums">{count}</span>
                      </li>
                    ))}
                </ul>
              )}
            </Panel>

            <div className="lg:col-span-2">
              <Panel
                title="Latest payments"
                actions={
                  <Link to="/admin/payments" className="text-sm text-primary hover:underline">
                    All payments
                  </Link>
                }
              >
                {d.recent.length === 0 ? (
                  <EmptyState>No payments yet.</EmptyState>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground text-left">
                        <tr>
                          <th className="py-2 pr-3 font-medium">Payment</th>
                          <th className="py-2 pr-3 font-medium">Amount</th>
                          <th className="py-2 pr-3 font-medium">Payout</th>
                          <th className="py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {d.recent.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2 pr-3">
                              <Link
                                to="/admin/payments/$id"
                                params={{ id: p.id }}
                                className="font-mono text-xs text-primary hover:underline"
                              >
                                {p.id.slice(0, 8)}
                              </Link>
                              <div className="text-xs text-muted-foreground">
                                {new Date(p.created_at).toLocaleString()}
                              </div>
                            </td>
                            <td className="py-2 pr-3 tabular-nums">
                              {formatMinor(BigInt(p.source_amount_minor), p.source_currency)}{" "}
                              {p.source_currency.toUpperCase()}
                            </td>
                            <td className="py-2 pr-3 tabular-nums">
                              {p.destination_amount_minor === null
                                ? "—"
                                : `${formatMinor(BigInt(p.destination_amount_minor), p.destination_currency)} ${p.destination_currency.toUpperCase()}`}
                              <div className="text-xs text-muted-foreground">
                                {p.destination_country}
                              </div>
                            </td>
                            <td className="py-2 capitalize">{label(p.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          </div>

          <Panel title="Last Stables webhook received">
            <p className="text-sm">
              {d.lastWebhook
                ? `${d.lastWebhook.event_type} · ${new Date(d.lastWebhook.received_at).toLocaleString()}`
                : "No webhook stored yet."}{" "}
              <Link to="/admin/system-status" className="text-primary hover:underline">
                System status
              </Link>
            </p>
          </Panel>
        </>
      )}
    </AdminPage>
  );
}
