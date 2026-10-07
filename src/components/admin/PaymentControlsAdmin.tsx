import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { OctagonPause, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Panel } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { formatMinor, toMinor } from "@/lib/money";
import {
  getPaymentControlsAdmin,
  updatePaymentControlsAdmin,
} from "@/lib/payment-controls.functions";

type Row = { currency: string; paused: boolean; reason: string; min: string; max: string };

const input = "h-9 rounded-md border border-border bg-background px-2 text-sm";

function toRows(
  corridors: Record<
    string,
    { paused: boolean; reason: string | null; min_minor: number | null; max_minor: number | null }
  >,
): Row[] {
  const major = (m: number | null) =>
    m === null ? "" : formatMinor(BigInt(m), "usdc").replace(/,/g, "");
  return Object.entries(corridors)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, r]) => ({
      currency,
      paused: r.paused,
      reason: r.reason ?? "",
      min: major(r.min_minor),
      max: major(r.max_minor),
    }));
}

function minorOrNull(value: string): number | null {
  const v = value.trim().replace(/,/g, "");
  return v ? Number(toMinor(v, "usdc")) : null;
}

/**
 * Emergency controls for the active mode: pause all new payments, pause one
 * payout currency, or narrow one currency's limits. Enforced on the server;
 * existing transfers keep following Stables.
 */
export function PaymentControlsAdmin() {
  const fetchControls = useServerFn(getPaymentControlsAdmin);
  const save = useServerFn(updatePaymentControlsAdmin);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin-payment-controls"], queryFn: () => fetchControls() });
  const [paused, setPaused] = useState(false);
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [newCurrency, setNewCurrency] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!query.data) return;
    setPaused(query.data.controls.paused);
    setReason(query.data.controls.reason ?? "");
    setRows(toRows(query.data.controls.corridors));
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          note: note.trim(),
          controls: {
            paused,
            reason: reason.trim() || null,
            corridors: Object.fromEntries(
              rows.map((r) => [
                r.currency,
                {
                  paused: r.paused,
                  reason: r.reason.trim() || null,
                  min_minor: minorOrNull(r.min),
                  max_minor: minorOrNull(r.max),
                },
              ]),
            ),
          },
        },
      }),
    onSuccess: () => {
      toast.success("Payment controls saved");
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["admin-payment-controls"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = (i: number, patch: Partial<Row>) =>
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const coin = query.data?.coinLimits.usdc;

  return (
    <Panel title="Emergency controls">
      {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {query.isError && (
        <p className="text-sm text-destructive">{(query.error as Error).message}</p>
      )}
      {query.data && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Mode: <span className="font-semibold uppercase">{query.data.mode}</span>. These rules
            apply to this mode only. A pause stops new payments, quotes, transfers and in-app
            deposits on the server; payments already sent keep following Stables. Coin limits:{" "}
            {coin ? `${coin.min} – ${coin.max ?? "no maximum"} USDC` : "misconfigured"}; a currency
            rule can only narrow them.
          </p>

          <div
            className={`rounded-xl border p-4 space-y-2 ${paused ? "border-destructive/40 bg-destructive/10" : "border-border/60"}`}
          >
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={paused}
                onChange={(e) => setPaused(e.target.checked)}
              />
              <OctagonPause className="w-4 h-4 text-destructive" />
              Pause all new payments
            </label>
            <input
              className={`${input} w-full`}
              placeholder="Reason (required when paused; shown in the audit log)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold">Per payout currency</div>
            {rows.length === 0 && (
              <p className="text-xs text-muted-foreground">No currency rules. Add one below.</p>
            )}
            {rows.map((r, i) => (
              <div
                key={r.currency}
                className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-center text-sm"
              >
                <span className="font-mono font-semibold">{r.currency}</span>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={r.paused}
                    onChange={(e) => update(i, { paused: e.target.checked })}
                  />
                  Paused
                </label>
                <input
                  className={`${input} sm:col-span-2`}
                  placeholder="Reason"
                  value={r.reason}
                  onChange={(e) => update(i, { reason: e.target.value })}
                />
                <input
                  className={input}
                  inputMode="decimal"
                  placeholder="Min USDC"
                  value={r.min}
                  onChange={(e) => update(i, { min: e.target.value })}
                />
                <div className="flex gap-1">
                  <input
                    className={`${input} w-full`}
                    inputMode="decimal"
                    placeholder="Max USDC"
                    value={r.max}
                    onChange={(e) => update(i, { max: e.target.value })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${r.currency}`}
                    onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                className={`${input} w-28 uppercase`}
                placeholder="e.g. INR"
                maxLength={3}
                value={newCurrency}
                onChange={(e) => setNewCurrency(e.target.value.toUpperCase())}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !/^[A-Z]{3}$/.test(newCurrency) || rows.some((r) => r.currency === newCurrency)
                }
                onClick={() => {
                  setRows((all) => [
                    ...all,
                    { currency: newCurrency, paused: false, reason: "", min: "", max: "" },
                  ]);
                  setNewCurrency("");
                }}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add currency rule
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <input
              className={`${input} flex-1 min-w-60`}
              placeholder="Why are you changing this? (required, audited)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || note.trim().length < 3}
            >
              {mutation.isPending ? "Saving…" : "Save controls"}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
