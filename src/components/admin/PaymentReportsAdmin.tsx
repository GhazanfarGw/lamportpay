import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileBarChart } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { exportPaymentsCsvAdmin, getDailyReportAdmin } from "@/lib/admin-reports.functions";

const today = () => new Date().toISOString().slice(0, 10);
const input = "h-9 rounded-md border border-border bg-background px-2 text-sm";

function Pairs({ title, value }: { title: string; value: Record<string, unknown> }) {
  const entries = Object.entries(value);
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      {entries.length === 0 ? (
        <div className="text-xs text-muted-foreground">—</div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 text-xs">
          {entries.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono">{k}</dt>
              <dd className="tabular-nums">
                {typeof v === "object" ? JSON.stringify(v) : String(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** CSV export and the daily reconciliation report (UTC days). */
export function PaymentReportsAdmin() {
  const exportCsv = useServerFn(exportPaymentsCsvAdmin);
  const dailyReport = useServerFn(getDailyReportAdmin);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [day, setDay] = useState(today);

  const download = useMutation({
    mutationFn: () => exportCsv({ data: { from, to } }),
    onSuccess: (r) => {
      const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${r.rows} payments`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const report = useMutation({
    mutationFn: () => dailyReport({ data: { date: day } }),
    onError: (e: Error) => toast.error(e.message),
  });
  const r = report.data;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
      <h2 className="font-semibold flex items-center gap-2">
        <FileBarChart className="w-4 h-4 text-primary" /> Reports (UTC)
      </h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs space-y-1">
          <div className="text-muted-foreground">From</div>
          <input
            type="date"
            className={input}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-xs space-y-1">
          <div className="text-muted-foreground">To</div>
          <input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => download.mutate()}
          disabled={download.isPending}
        >
          <Download className="w-3.5 h-3.5 mr-2" />
          {download.isPending ? "Exporting…" : "Export CSV"}
        </Button>
        <span className="w-4" />
        <label className="text-xs space-y-1">
          <div className="text-muted-foreground">Daily report</div>
          <input
            type="date"
            className={input}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => report.mutate()}
          disabled={report.isPending}
        >
          {report.isPending ? "Loading…" : "Show report"}
        </Button>
      </div>
      {r && (
        <div className="grid sm:grid-cols-3 gap-4 rounded-xl border border-border/60 p-4">
          <Pairs title={`Created ${r.date} (${r.created})`} value={r.byStatus} />
          <Pairs title="Sent to Stables (funded/completed)" value={r.sentByCoin} />
          <Pairs title="LamportPay fee on those payments" value={r.feesOnPayments} />
          <Pairs title="Fee ledger entries that day" value={r.feeLedger} />
          <Pairs title="Completed payouts" value={r.payouts} />
          <Pairs
            title="Open now"
            value={{
              ...Object.fromEntries(
                Object.entries(r.openNow.cases).map(([k, v]) => [`case ${k}`, v]),
              ),
              "failed webhooks": r.openNow.webhookErrors,
              "waiting on Stables": r.openNow.waitingOnStables,
            }}
          />
          <ul className="sm:col-span-3 text-[11px] text-muted-foreground list-disc pl-4">
            {r.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
