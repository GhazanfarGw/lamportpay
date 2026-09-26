import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, Plug, RefreshCw } from "lucide-react";

type Provider = {
  name: string;
  role: string;
  configured: boolean;
  mode: "sandbox" | "mock";
  note: string;
};

type Endpoint = { path: string; provider: string; mode: "sandbox" | "mock" };

type Status = {
  providers: Provider[];
  endpoints: Endpoint[];
  guards: {
    fiatPayoutEnabled: boolean;
    kycEnabled: boolean;
    swapLimits: string;
    outputDestination: string;
  };
};

function ModePill({ mode }: { mode: "sandbox" | "mock" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        mode === "sandbox"
          ? "bg-primary/10 text-primary border border-primary/20"
          : "bg-muted text-muted-foreground border border-border/60"
      }`}
    >
      {mode === "sandbox" ? "sandbox" : "mock"}
    </span>
  );
}

export function IntegrationStatusPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integration-status");
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Could not load integration status.");
      else setStatus(data as Status);
    } catch {
      setError("Could not load integration status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="rounded-3xl border border-border/60 bg-card p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Plug className="w-4 h-4 text-primary" />
          Integration status
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {status && (
        <>
          <div className="grid md:grid-cols-2 gap-3">
            {status.providers.map((p) => (
              <div key={p.name} className="rounded-2xl border border-border/60 bg-background p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    {p.configured ? (
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                    ) : (
                      <CircleDashed className="w-4 h-4 text-muted-foreground" />
                    )}
                    {p.name}
                  </div>
                  <ModePill mode={p.mode} />
                </div>
                <div className="text-xs text-muted-foreground mt-2">{p.role}</div>
                <div className="text-xs mt-2">
                  {p.configured ? "Key configured" : "Key not configured"} — {p.note}
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Endpoint data source
            </div>
            <div className="rounded-2xl border border-border/60 overflow-hidden">
              {status.endpoints.map((e) => (
                <div
                  key={e.path}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/40 last:border-0 bg-background"
                >
                  <span className="font-mono text-xs truncate">{e.path}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">{e.provider}</span>
                    <ModePill mode={e.mode} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>Fiat payout: {status.guards.fiatPayoutEnabled ? "enabled" : "disabled"}</div>
            <div>KYC: {status.guards.kycEnabled ? "enabled" : "disabled"}</div>
            <div>Swap limits: {status.guards.swapLimits}</div>
            <div>Output destination: {status.guards.outputDestination}</div>
          </div>
        </>
      )}
    </div>
  );
}
