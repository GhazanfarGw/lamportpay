import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import {
  AdminPage,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
} from "@/components/admin/AdminShell";
import { getRevenueReport } from "@/lib/admin-ops.functions";
import { formatMinor } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/admin/reports")({
  head: () => ({ meta: [{ title: "Reports | LamportPay Admin" }] }),
  component: ReportsPage,
});

type Period = "day" | "week" | "month";
const PERIOD_LABEL: Record<Period, string> = { day: "Daily", week: "Weekly", month: "Monthly" };

function ReportsPage() {
  const [period, setPeriod] = useState<Period>("day");
  const fetchReport = useServerFn(getRevenueReport);
  const query = useQuery({
    queryKey: ["admin-revenue-report", period],
    queryFn: () => fetchReport({ data: { period } }),
  });
  const report = query.data;

  return (
    <AdminPage
      title="Reports"
      crumbs={[{ label: "Reports" }]}
      description="LamportPay revenue by the date the funding transaction was verified on Solana (UTC). Weeks start on Monday."
    >
      <div
        className="inline-flex rounded-lg border border-border/60 bg-background p-1"
        role="tablist"
      >
        {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={period === p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 text-sm rounded-md ${
              period === p ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      <Panel title={`${PERIOD_LABEL[period]} revenue`}>
        {query.isLoading && <LoadingState />}
        {query.isError && <ErrorState error={query.error} />}
        {report && report.rows.length === 0 && (
          <EmptyState>No verified payment has carried a LamportPay fee yet.</EmptyState>
        )}
        {report && report.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground text-left">
                <tr>
                  <th className="py-2 pr-3 font-medium">
                    {period === "month" ? "Month" : period === "week" ? "Week of" : "Day"}
                  </th>
                  <th className="py-2 pr-3 font-medium text-right">Payments</th>
                  <th className="py-2 pr-3 font-medium text-right">Expected (USDC)</th>
                  <th className="py-2 font-medium text-right">Received (USDC)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 tabular-nums">
                {report.rows.map((r) => (
                  <tr key={r.start}>
                    <td className="py-2 pr-3">{r.start}</td>
                    <td className="py-2 pr-3 text-right">{r.payments}</td>
                    <td className="py-2 pr-3 text-right">
                      {formatMinor(BigInt(r.expectedMinor), "usdc")}
                    </td>
                    <td className="py-2 text-right font-medium">
                      {formatMinor(BigInt(r.receivedMinor), "usdc")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.partial && (
              <p className="text-xs text-muted-foreground pt-2">
                Based on the latest 5,000 verified payments.
              </p>
            )}
          </div>
        )}
      </Panel>
    </AdminPage>
  );
}
