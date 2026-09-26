import { useEffect, useRef, useState } from "react";
import { CORRIDORS, TOKEN_USD, TOKENS, fmt } from "./demo-data";
import { Activity, TrendingDown, TrendingUp } from "lucide-react";

type Tick = { key: string; label: string; value: number; prev: number };

function jitter(v: number, pct = 0.0015) {
  const delta = v * pct * (Math.random() * 2 - 1);
  return v + delta;
}

function initialTicks(): Tick[] {
  const fx: Tick[] = CORRIDORS.map((c) => ({
    key: `USD/${c.currency}`,
    label: `USD/${c.currency}`,
    value: c.rate,
    prev: c.rate,
  }));
  const tokens: Tick[] = TOKENS.filter((t) => t !== "USDC" && t !== "USDT").map((t) => ({
    key: t,
    label: `${t}/USD`,
    value: TOKEN_USD[t],
    prev: TOKEN_USD[t],
  }));
  return [...tokens, ...fx];
}

export function LiveRatesTicker() {
  const [ticks, setTicks] = useState<Tick[]>(initialTicks);

  useEffect(() => {
    const id = setInterval(() => {
      setTicks((prev) =>
        prev.map((t) => {
          const next = jitter(t.value, t.value < 1 ? 0.004 : 0.0018);
          return { ...t, prev: t.value, value: Math.max(0.0000001, next) };
        }),
      );
    }, 1600);
    return () => clearInterval(id);
  }, []);

  const loop = [...ticks, ...ticks];

  return (
    <div className="relative overflow-hidden border-y border-primary/20 bg-[oklch(0.14_0.05_275)] text-white">
      <div className="pointer-events-none absolute inset-0 bg-grid-uv opacity-60" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-[oklch(0.14_0.05_275)] to-transparent z-10" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-[oklch(0.14_0.05_275)] to-transparent z-10" />
      <div className="relative flex items-center gap-4 py-3">
        <div className="shrink-0 pl-4 flex items-center gap-2 z-20 pr-3 border-r border-white/10">
          <span className="relative flex w-2.5 h-2.5">
            <span className="absolute inset-0 rounded-full bg-[color:var(--success)] animate-live-dot" />
            <span className="relative rounded-full w-2.5 h-2.5 bg-[color:var(--success)]" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-widest text-white/80 flex items-center gap-1.5">
            <Activity className="w-3 h-3" /> Demo mode
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="flex gap-8 animate-ticker whitespace-nowrap will-change-transform">
            {loop.map((t, i) => {
              const up = t.value >= t.prev;
              const digits = t.value >= 100 ? 2 : t.value >= 1 ? 3 : 6;
              return (
                <span key={i} className="inline-flex items-center gap-2 text-sm font-mono">
                  <span className="text-white/50">{t.label}</span>
                  <span
                    key={t.value}
                    className="animate-rate-tick font-semibold tabular-nums text-white"
                  >
                    {fmt(t.value, digits)}
                  </span>
                  {up ? (
                    <TrendingUp className="w-3.5 h-3.5 text-[oklch(0.82_0.2_150)]" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 text-[oklch(0.72_0.24_25)]" />
                  )}
                  <span className="text-white/20">·</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function StatsStrip() {
  const stats = [
    {
      k: "15M+ swap traders",
      v: "Jupiter ecosystem",
      sub: "Historical Jupiter Research/Jupuary ecosystem figure, not LamportPay users.",
    },
    {
      k: "100+ liquidity sources",
      v: "Swap infrastructure",
      sub: "Jupiter scans Solana liquidity sources to optimize swap execution.",
    },
    {
      k: "Demo only",
      v: "LamportPay status",
      sub: "Real fiat payout is disabled until licensed partner approval.",
    },
  ];
  return (
    <div className="relative rounded-3xl border border-primary/20 bg-[oklch(0.16_0.06_275)] text-white overflow-hidden animate-uv-scan">
      <div className="absolute inset-0 bg-grid-uv opacity-70 pointer-events-none" />
      <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-[oklch(0.6_0.28_295)] opacity-30 blur-3xl animate-uv-pulse" />
      <div className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full bg-[oklch(0.7_0.24_200)] opacity-30 blur-3xl animate-uv-pulse" />
      <div className="relative grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/5">
        {stats.map((s) => (
          <div key={s.k} className="p-5 md:p-6">
            <div className="text-sm font-medium text-white/90">{s.v}</div>
            <div className="mt-1 text-2xl md:text-3xl font-semibold tracking-tight text-uv">
              {s.k}
            </div>
            <div className="text-[11px] text-white/50 mt-1.5 leading-relaxed">{s.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
