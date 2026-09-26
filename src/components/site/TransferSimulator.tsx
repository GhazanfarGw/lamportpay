import { useMemo, useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import { CORRIDORS, PAYOUT_METHODS, TOKENS, type Token, calcQuote, fmt } from "./demo-data";
import { Link } from "@tanstack/react-router";

export function TransferSimulator({ compact = false }: { compact?: boolean }) {
  const [amount, setAmount] = useState<string>("500");
  const [token, setToken] = useState<Token>("USDC");
  const [corridorIdx, setCorridorIdx] = useState(0);
  const [method, setMethod] = useState<(typeof PAYOUT_METHODS)[number]>("Bank account");
  const corridor = CORRIDORS[corridorIdx];
  const num = parseFloat(amount) || 0;

  const quote = useMemo(
    () => calcQuote(num, token, corridor.currency),
    [num, token, corridor.currency],
  );

  return (
    <div className="relative">
      <div className="absolute -inset-8 bg-[image:var(--gradient-hero)] opacity-20 blur-3xl rounded-[3rem] -z-10" />
      <div className="rounded-3xl bg-card border border-border/60 shadow-[var(--shadow-elegant)] overflow-hidden">
        <div className="grid md:grid-cols-2">
          <div className="p-6 md:p-8 space-y-5 border-b md:border-b-0 md:border-r border-border/60">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                You send
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent text-accent-foreground font-semibold">
                DEMO
              </span>
            </div>
            <div className="flex gap-3 items-center">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className="w-full text-4xl md:text-5xl font-semibold bg-transparent outline-none tracking-tight"
              />
              <select
                value={token}
                onChange={(e) => setToken(e.target.value as Token)}
                className="rounded-xl border border-border bg-secondary px-4 py-2 font-semibold"
              >
                {TOKENS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Recipient country">
                <select
                  value={corridorIdx}
                  onChange={(e) => setCorridorIdx(parseInt(e.target.value))}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                >
                  {CORRIDORS.map((c, i) => (
                    <option key={c.currency} value={i}>
                      {c.flag} {c.country}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Currency">
                <div className="w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm font-semibold">
                  {corridor.currency}
                </div>
              </Field>
            </div>

            <Field label="Payout method">
              <div className="grid grid-cols-2 gap-2">
                {PAYOUT_METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={
                      "text-sm px-3 py-2 rounded-xl border transition " +
                      (method === m
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border hover:border-primary/40")
                    }
                  >
                    {m}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div className="p-6 md:p-8 bg-[image:var(--gradient-card)] space-y-4">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Recipient gets
            </div>
            <div className="flex items-baseline gap-2">
              <div className="text-4xl md:text-5xl font-semibold tracking-tight">
                {fmt(quote.recipientAmount, 2)}
              </div>
              <div className="text-lg font-semibold text-muted-foreground">{corridor.currency}</div>
            </div>
            <div className="space-y-2 text-sm border-t border-border/60 pt-4">
              <Row k="Estimated USDC settlement" v={`${fmt(quote.usdcSettlement)} USDC`} />
              <Row
                k="FX rate"
                v={`1 USD = ${fmt(quote.fxRate, quote.fxRate > 100 ? 0 : 2)} ${corridor.currency}`}
              />
              <Row k="Partner payout fee" v={`$${fmt(quote.payoutFee)}`} />
              <Row k="LamportPay fee" v={`$${fmt(quote.platformFee)}`} />
              <Row k="Estimated delivery" v="Under 5 minutes" />
            </div>
            {!compact && (
              <Link
                to="/send"
                className="mt-2 flex items-center justify-center gap-2 w-full rounded-2xl py-3.5 font-semibold text-white bg-[image:var(--gradient-hero)] shadow-[var(--shadow-elegant)] hover:opacity-95 transition"
              >
                Start demo transfer <ArrowRight className="w-4 h-4" />
              </Link>
            )}
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 leading-relaxed">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Demo values only. No real crypto, fiat, or KYC is processed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
