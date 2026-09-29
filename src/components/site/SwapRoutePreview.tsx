import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Route as RouteIcon, RefreshCw, Info } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { solToLamports, type SwapRoutePreview as Preview } from "@/lib/swap-route";
import { SOL_MINT, USDC_MINT } from "@/lib/tokens";

const MIN_SOL = 0.001;
const MAX_SOL = 0.01;

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className="text-sm font-medium text-right">{v}</span>
    </div>
  );
}

const fmtUsd = (n: number | null) => (n === null ? "n/a" : `$${n.toFixed(n < 1 ? 4 : 2)}`);

/**
 * Live, read-only swap route from Jupiter for a signed-in user. There is no
 * mock mode: when Jupiter can't route, the card shows the error, never
 * invented numbers.
 */
export function SwapRoutePreviewCard({ defaultSol = MIN_SOL }: { defaultSol?: number }) {
  const [sol, setSol] = useState(String(defaultSol));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const amountSol = parseFloat(sol) || 0;
  const outOfRange = amountSol < MIN_SOL || amountSol > MAX_SOL;

  const loadPreview = useCallback(async () => {
    if (outOfRange) return;
    setLoading(true);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) {
        setSignedOut(true);
        setPreview(null);
        return;
      }
      setSignedOut(false);
      const res = await fetch("/api/jupiter/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          inputMint: SOL_MINT,
          outputMint: USDC_MINT,
          amount: solToLamports(amountSol),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setSignedOut(true);
        setPreview(null);
      } else if (!res.ok) {
        setError((data as { error?: string }).error ?? "Route preview failed.");
        setPreview(null);
      } else {
        setPreview(data as Preview);
      }
    } catch {
      setError("Could not reach the route preview endpoint.");
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [amountSol, outOfRange]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  return (
    <div className="rounded-3xl border border-border/60 bg-card p-6 space-y-5 shadow-[var(--shadow-soft)]">
      <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Amount (SOL)</span>
          <input
            value={sol}
            onChange={(e) => setSol(e.target.value.replace(/[^0-9.]/g, ""))}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5"
          />
        </label>
        <button
          onClick={() => void loadPreview()}
          disabled={loading || outOfRange}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-card border border-border px-4 py-2.5 text-sm font-semibold hover:bg-secondary transition disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Fetching route…" : "Refresh route preview"}
        </button>
      </div>

      {outOfRange && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          Amount must be between {MIN_SOL} and {MAX_SOL} SOL.
        </div>
      )}
      {signedOut && (
        <div className="rounded-xl border border-border bg-secondary px-4 py-3 text-sm">
          Sign in to see a live route.{" "}
          <Link
            to="/auth"
            search={{ next: "/swap" }}
            className="font-semibold text-primary hover:underline"
          >
            Sign in
          </Link>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-border bg-secondary px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {preview && (
        <div className="rounded-2xl border border-border/60 bg-background p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <RouteIcon className="w-4 h-4 text-primary" />
            Swap route preview
          </div>

          <p className="text-xs text-muted-foreground">{preview.message}</p>

          {preview.steps.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Route steps
              </div>
              <ol className="space-y-2">
                {preview.steps.map((s, i) => (
                  <li
                    key={`${s.amm}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="inline-flex w-6 h-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{s.label}</div>
                        <div className="text-xs text-muted-foreground truncate">{s.amm}</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold">{s.percent}%</div>
                      <div className="text-xs text-muted-foreground">
                        {s.feeUsd !== null ? `fee ${fmtUsd(s.feeUsd)}` : "fee n/a"}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-x-6">
            <div>
              <Row k="Input" v={`${preview.inAmountSol} SOL`} />
              <Row k="Expected USDC output" v={`${preview.outAmountUsdc.toFixed(4)} USDC`} />
              <Row
                k="Minimum received"
                v={
                  preview.minOutAmountUsdc !== null
                    ? `${preview.minOutAmountUsdc.toFixed(4)} USDC`
                    : "set when you swap"
                }
              />
              <Row
                k="Slippage tolerance"
                v={
                  preview.slippageBps
                    ? `${(preview.slippageBps / 100).toFixed(2)}%`
                    : "set when you swap"
                }
              />
            </div>
            <div>
              <Row
                k="Price impact"
                v={
                  preview.priceImpactPct !== null
                    ? `${preview.priceImpactPct.toFixed(3)}%`
                    : "unknown"
                }
              />
              <Row
                k="Swap fee"
                v={
                  preview.swapFeeBps !== null
                    ? `${(preview.swapFeeBps / 100).toFixed(2)}% (${fmtUsd(preview.swapFeeUsd)})`
                    : "n/a"
                }
              />
              <Row
                k="Solana network fee"
                v={
                  preview.networkFeeLamports !== null
                    ? `${Number(preview.networkFeeLamports) / 1e9} SOL`
                    : "set when you swap"
                }
              />
            </div>
          </div>

          <div className="flex gap-2 rounded-xl border border-border/60 bg-secondary px-4 py-3 text-xs text-muted-foreground">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Output destination is always your own connected wallet. Nothing is signed or sent from
              this preview.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
