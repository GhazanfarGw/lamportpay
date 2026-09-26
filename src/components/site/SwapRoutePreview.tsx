import { useCallback, useEffect, useState } from "react";
import { Route as RouteIcon, RefreshCw, ToggleLeft, ToggleRight, Info } from "lucide-react";

import {
  buildMockRoutePreview,
  solToLamports,
  type SwapRoutePreview as Preview,
} from "@/lib/swap-route";
import { SOL_MINT, USDC_MINT } from "@/lib/tokens";

const MIN_SOL = 0.001;
const MAX_SOL = 0.01;

function ModeBadge({ source }: { source: Preview["source"] }) {
  const sandbox = source === "sandbox";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
        sandbox
          ? "bg-primary/10 text-primary border border-primary/20"
          : "bg-muted text-muted-foreground border border-border/60"
      }`}
    >
      {sandbox ? "Sandbox data" : "Mock data"}
    </span>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className="text-sm font-medium text-right">{v}</span>
    </div>
  );
}

export function SwapRoutePreviewCard({ defaultSol = MIN_SOL }: { defaultSol?: number }) {
  const [jupiterMode, setJupiterMode] = useState(false);
  const [sol, setSol] = useState(String(defaultSol));
  const [preview, setPreview] = useState<Preview>(() =>
    buildMockRoutePreview(solToLamports(defaultSol), "Mock routing preview (Jupiter API mode off)."),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountSol = parseFloat(sol) || 0;
  const outOfRange = amountSol < MIN_SOL || amountSol > MAX_SOL;

  const loadPreview = useCallback(async () => {
    if (outOfRange) return;
    const lamports = solToLamports(amountSol);
    if (!jupiterMode) {
      setError(null);
      setPreview(buildMockRoutePreview(lamports, "Mock routing preview (Jupiter API mode off)."));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/jupiter/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputMint: SOL_MINT, outputMint: USDC_MINT, amount: lamports }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Route preview failed.");
        setPreview(
          buildMockRoutePreview(lamports, "Route preview failed — showing mock routing instead."),
        );
      } else {
        setPreview(data as Preview);
      }
    } catch {
      setError("Could not reach the route preview endpoint.");
      setPreview(buildMockRoutePreview(lamports, "Network error — showing mock routing instead."));
    } finally {
      setLoading(false);
    }
  }, [amountSol, jupiterMode, outOfRange]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

  return (
    <div className="rounded-3xl border border-border/60 bg-card p-6 space-y-5 shadow-[var(--shadow-soft)]">
      <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            {jupiterMode ? (
              <ToggleRight className="w-5 h-5 text-primary" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          <div>
            <div className="font-semibold text-sm">Jupiter API mode</div>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              When on, the route and quote come from Jupiter in sandbox mode. If the key isn&apos;t
              configured, it falls back to mock routing. Preview only — nothing is signed or sent.
            </p>
          </div>
        </div>
        <button
          onClick={() => setJupiterMode((v) => !v)}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
            jupiterMode
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border hover:bg-secondary"
          }`}
        >
          {jupiterMode ? "Jupiter mode on" : "Jupiter mode off"}
        </button>
      </div>

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
      {error && (
        <div className="rounded-xl border border-border bg-secondary px-4 py-3 text-sm">{error}</div>
      )}

      <div className="rounded-2xl border border-border/60 bg-background p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <RouteIcon className="w-4 h-4 text-primary" />
            Swap route preview
          </div>
          <ModeBadge source={preview.source} />
        </div>

        <p className="text-xs text-muted-foreground">{preview.message}</p>

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

        <div className="grid md:grid-cols-2 gap-x-6">
          <div>
            <Row k="Input" v={`${preview.inAmountSol} SOL`} />
            <Row k="Expected USDC output" v={`${preview.outAmountUsdc.toFixed(4)} USDC`} />
            <Row k="Minimum received" v={`${preview.minOutAmountUsdc.toFixed(4)} USDC`} />
            <Row k="Slippage tolerance" v={`${(preview.slippageBps / 100).toFixed(2)}%`} />
          </div>
          <div>
            <Row
              k="Price impact"
              v={
                preview.priceImpactPct !== null ? `${preview.priceImpactPct.toFixed(3)}%` : "unknown"
              }
            />
            <Row k="Liquidity / AMM fees" v={fmtUsd(preview.lpFeeUsd)} />
            <Row k="Platform fee" v={fmtUsd(preview.platformFeeUsd)} />
            <Row k="Solana network fee" v={`${preview.networkFeeSol} SOL`} />
          </div>
        </div>

        <div className="flex gap-2 rounded-xl border border-border/60 bg-secondary px-4 py-3 text-xs text-muted-foreground">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Output destination is always your own connected wallet. Fiat payout, Partner payout and
            KYC stay disabled in this preview.
          </span>
        </div>
      </div>
    </div>
  );
}
