import { useCallback, useEffect, useState } from "react";
import { Activity, ExternalLink, Loader2, RefreshCw, SearchCheck } from "lucide-react";

import { SOLANA_CLUSTERS, type SolanaCluster } from "@/lib/solana-rpc";

type Health = {
  cluster: string;
  reachable: boolean;
  slot: number | null;
  blockHeight: number | null;
  solanaCore: string | null;
  latencyMs: number;
  customEndpoint: boolean;
  endpointProvider: string | null;
  jupiterSwapAvailable: boolean;
  note: string;
  error: string | null;
};

type Verification = {
  found: boolean;
  success?: boolean;
  confirmationStatus?: string | null;
  confirmations?: number | null;
  slot?: number | null;
  feeLamports?: number | null;
  solLamportsDelta?: number;
  usdcUiDelta?: number;
  explorerUrl?: string;
  error?: string | null;
};

export function SolanaRpcVerifier() {
  const [cluster, setCluster] = useState<SolanaCluster>("devnet");
  const [health, setHealth] = useState<Health | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [signature, setSignature] = useState("");
  const [owner, setOwner] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(async (target: SolanaCluster) => {
    setLoadingHealth(true);
    try {
      const res = await fetch(`/api/solana/health?cluster=${target}`);
      setHealth((await res.json()) as Health);
    } catch {
      setHealth(null);
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  useEffect(() => {
    setResult(null);
    setError(null);
    void loadHealth(cluster);
  }, [cluster, loadHealth]);

  const verify = useCallback(async () => {
    setVerifying(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/solana/verify-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signature: signature.trim(),
          cluster,
          ...(owner.trim() ? { owner: owner.trim() } : {}),
        }),
      });
      const data = (await res.json()) as Verification;
      if (!res.ok) setError(data.error ?? "Could not verify this transaction.");
      setResult(data);
    } catch {
      setError("Could not reach the verification endpoint.");
    } finally {
      setVerifying(false);
    }
  }, [signature, cluster, owner]);

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="w-4 h-4 text-primary" />
            Solana RPC test &amp; transaction verification
          </div>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            Read-only checks against Solana RPC. Nothing is signed or sent here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadHealth(cluster)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingHealth ? "animate-spin" : ""}`} /> Recheck
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {SOLANA_CLUSTERS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCluster(c)}
            className={
              "rounded-xl px-3 py-1.5 text-xs font-semibold border transition " +
              (cluster === c
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary")
            }
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Stat k="Reachable" v={health ? (health.reachable ? "yes" : "no") : "—"} />
        <Stat k="Latency" v={health ? `${health.latencyMs} ms` : "—"} />
        <Stat k="Slot" v={health?.slot != null ? String(health.slot) : "—"} />
        <Stat k="Block height" v={health?.blockHeight != null ? String(health.blockHeight) : "—"} />
        <Stat k="Validator" v={health?.solanaCore ?? "—"} />
        <Stat k="Jupiter swaps" v={health ? (health.jupiterSwapAvailable ? "available" : "not available") : "—"} />
        <Stat k="RPC provider" v={health?.endpointProvider ?? "Public Solana RPC"} />
      </div>

      {health?.note && (
        <p className="rounded-xl border border-border/60 bg-secondary/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {health.note}
        </p>
      )}

      <div className="space-y-2">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Verify a transaction signature
        </label>
        <input
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder="Paste a base58 transaction signature"
          className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-mono outline-none focus:border-primary/50"
        />
        <input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="Optional: wallet address that should receive USDC"
          className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-mono outline-none focus:border-primary/50"
        />
        <button
          type="button"
          onClick={verify}
          disabled={verifying || signature.trim().length < 64}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-[image:var(--gradient-hero)] disabled:opacity-50"
        >
          {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchCheck className="w-4 h-4" />}
          Verify on {cluster}
        </button>
        <p className="text-[11px] text-muted-foreground">
          Never paste a private key or seed phrase. Only public transaction signatures are accepted.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {result?.found && (
        <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/40 px-4 py-3">
          <Stat k="Status" v={result.success ? "success" : "failed"} />
          <Stat k="Confirmation" v={result.confirmationStatus ?? "—"} />
          <Stat k="Slot" v={result.slot != null ? String(result.slot) : "—"} />
          <Stat
            k="Fee"
            v={result.feeLamports != null ? `${result.feeLamports} lamports` : "—"}
          />
          <Stat
            k="SOL change (fee payer)"
            v={result.solLamportsDelta != null ? `${result.solLamportsDelta} lamports` : "—"}
          />
          <Stat
            k="USDC change"
            v={result.usdcUiDelta != null ? result.usdcUiDelta.toFixed(6) : "—"}
          />
          {result.explorerUrl && (
            <a
              href={result.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              View on Solana Explorer <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono font-medium break-all text-right">{v}</span>
    </div>
  );
}

export default SolanaRpcVerifier;