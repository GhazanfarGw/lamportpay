import { useHydrated } from "@/hooks/use-hydrated";
import { useEffect, useMemo, useRef, useState } from "react";
import { CORRIDORS, TOKENS, TOKEN_USD, fmt } from "./demo-data";
import {
  ArrowRight,
  Zap,
  Route as RouteIcon,
  Wallet,
  Building2,
  CheckCircle2,
  Sparkles,
  Flame,
  Activity,
} from "lucide-react";

// Token color chips (UV-neon)
const TOKEN_COLOR: Record<string, string> = {
  SOL: "oklch(0.72 0.2 285)",
  USDC: "oklch(0.72 0.16 220)",
  USDT: "oklch(0.78 0.18 160)",
  JUP: "oklch(0.82 0.2 55)",
  RAY: "oklch(0.72 0.22 305)",
  PYTH: "oklch(0.78 0.2 340)",
  BONK: "oklch(0.82 0.2 75)",
};

// Photo-realistic sender faces (MoonPay-style), generated for LamportPay.
import face1 from "@/assets/face-1.jpg";
import face2 from "@/assets/face-2.jpg";
import face3 from "@/assets/face-3.jpg";
import face4 from "@/assets/face-4.jpg";
import face5 from "@/assets/face-5.jpg";
import face6 from "@/assets/face-6.jpg";
import face7 from "@/assets/face-7.jpg";
import face8 from "@/assets/face-8.jpg";

const AVATARS = [face1, face2, face3, face4, face5, face6, face7, face8];
const NAMES = [
  "Ayaan",
  "Priya",
  "Chinedu",
  "Mei",
  "Diego",
  "Fatima",
  "Yusuf",
  "Sofia",
  "Kenji",
  "Amara",
];
const SENDER_CITIES = [
  "New York",
  "London",
  "Dubai",
  "Singapore",
  "Berlin",
  "Toronto",
  "Sydney",
  "San Francisco",
];

type Swap = {
  id: number;
  token: string;
  amount: number;
  usd: number;
  corridor: (typeof CORRIDORS)[number];
  local: number;
  who: string;
  avatar: string;
  from: string;
  ms: number;
};

let seq = 0;
// Deterministic PRNG so SSR and the first client render produce identical
// markup (avoids React hydration mismatch crashes).
function seeded(i: number) {
  let s = (i * 1664525 + 1013904223) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function mkSwap(seed?: number): Swap {
  const r = seed === undefined ? Math.random : seeded(seed + 1);
  const tok = TOKENS[Math.floor(r() * TOKENS.length)];
  const c = CORRIDORS[Math.floor(r() * CORRIDORS.length)];
  const usd = Math.round(50 + r() * 4950);
  const amount = usd / (TOKEN_USD[tok] || 1);
  return {
    id: seed === undefined ? ++seq : -(seed + 1),
    token: tok,
    amount,
    usd,
    corridor: c,
    local: usd * 0.985 * c.rate,
    who: NAMES[Math.floor(r() * NAMES.length)],
    avatar: AVATARS[Math.floor(r() * AVATARS.length)],
    from: SENDER_CITIES[Math.floor(r() * SENDER_CITIES.length)],
    ms: 700 + Math.floor(r() * 3200),
  };
}

export function LiveSwapTheater() {
  const [current, setCurrent] = useState<Swap>(() => mkSwap(0));
  const [stream, setStream] = useState<Swap[]>(() =>
    Array.from({ length: 6 }, (_, i) => mkSwap(i + 1)),
  );
  const [progress, setProgress] = useState(0); // 0..1 through the route
  const hydrated = useHydrated();

  // Cycle the featured swap
  useEffect(() => {
    if (!hydrated) return;
    const id = setInterval(() => {
      const s = mkSwap();
      setCurrent(s);
      setStream((p) => [s, ...p].slice(0, 6));
      setProgress(0);
    }, 3600);
    return () => clearInterval(id);
  }, [hydrated]);

  // Route progress animation
  useEffect(() => {
    if (!hydrated) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 3200);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [current.id, hydrated]);

  const nodes = [
    "Wallet",
    "Jupiter",
    "USDC",
    "Payout partner",
    `${current.corridor.flag} ${current.corridor.currency}`,
  ];
  const activeIdx = Math.min(nodes.length - 1, Math.floor(progress * nodes.length));

  return (
    <section className="mt-32">
      <div className="max-w-7xl mx-auto px-5">
        <div className="text-center max-w-3xl mx-auto">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center justify-center gap-2">
            <Flame className="w-3.5 h-3.5" /> Jupiter route preview · Demo mode
          </div>
          <h2 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight">
            See how a Jupiter SOL → USDC swap is routed.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Built using the Jupiter Swap API. Swap output returns to your connected wallet —
            LamportPay does not custody funds and fiat payout is disabled.
          </p>
        </div>

        <div className="mt-10 relative rounded-3xl border border-primary/25 bg-[oklch(0.11_0.05_275)] text-white overflow-hidden shadow-[var(--shadow-elegant)]">
          <div className="absolute inset-0 bg-grid-uv opacity-60 pointer-events-none" />
          <div className="absolute -top-40 -left-24 w-[520px] h-[520px] rounded-full bg-[oklch(0.6_0.28_295)] opacity-25 blur-3xl animate-uv-pulse pointer-events-none" />
          <div className="absolute -bottom-40 -right-24 w-[520px] h-[520px] rounded-full bg-[oklch(0.7_0.28_330)] opacity-20 blur-3xl animate-uv-pulse pointer-events-none" />

          {/* Counters bar */}
          <div className="relative border-b border-white/10 grid grid-cols-2 md:grid-cols-4 divide-x divide-white/10 bg-black/20 backdrop-blur">
            <Counter
              label="Jupiter route preview"
              value="SOL → USDC"
              icon={<Activity className="w-3 h-3" />}
            />
            <Counter label="Output" value="Connected wallet" icon={<Zap className="w-3 h-3" />} />
            <Counter
              label="Partner payout"
              value="Disabled"
              icon={<CheckCircle2 className="w-3 h-3" />}
              sub="No fiat payout"
            />
            <Counter
              label="Mode"
              value="Demo mode"
              icon={<Sparkles className="w-3 h-3" />}
              sub="Swap limits 0.001–0.01 SOL"
            />
          </div>

          <div className="relative grid lg:grid-cols-[1.35fr_1fr] gap-0">
            {/* LEFT: Jupiter-style swap terminal + route */}
            <div className="relative p-6 md:p-8 border-b lg:border-b-0 lg:border-r border-white/10">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[oklch(0.82_0.2_55)] to-[oklch(0.72_0.22_305)] flex items-center justify-center text-black font-bold text-xs">
                    J
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Jupiter Router</div>
                    <div className="text-[10px] text-white/50 font-mono">
                      v6 · aggregating 27 DEXs
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-[oklch(0.82_0.18_200)] flex items-center gap-1.5 border border-[oklch(0.82_0.18_200)]/30 rounded-full px-2 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.82_0.18_200)] animate-live-dot" />
                  QUOTING
                </span>
              </div>

              {/* Swap panels */}
              <div className="space-y-2">
                <SwapPanel
                  label="You pay"
                  token={current.token}
                  amount={fmt(current.amount, current.token === "BONK" ? 0 : 3)}
                  usd={current.usd}
                />
                <div className="relative flex justify-center">
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-white/10" />
                  <div className="relative w-9 h-9 rounded-xl bg-[oklch(0.16_0.06_275)] border border-white/10 flex items-center justify-center animate-uv-pulse">
                    <ArrowRight className="w-4 h-4 rotate-90 text-[oklch(0.82_0.18_200)]" />
                  </div>
                </div>
                <SwapPanel
                  label="Recipient gets"
                  token={current.corridor.currency}
                  amount={fmt(current.local, 0)}
                  flag={current.corridor.flag}
                  highlight
                  usd={current.usd * 0.985}
                />
              </div>

              {/* Route visualization */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2 text-[10px] font-mono uppercase tracking-widest text-white/50">
                  <span className="flex items-center gap-1.5">
                    <RouteIcon className="w-3 h-3" /> Route
                  </span>
                  <span>
                    {Math.round(progress * 100)}% · {current.ms}ms
                  </span>
                </div>
                <div className="relative rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-px bg-white/10" />
                  <div
                    className="absolute left-4 top-1/2 -translate-y-1/2 h-[2px] bg-gradient-to-r from-[oklch(0.82_0.18_200)] via-[oklch(0.7_0.28_330)] to-[oklch(0.62_0.28_295)] shadow-[0_0_12px_oklch(0.7_0.28_330)]"
                    style={{ width: `calc((100% - 2rem) * ${progress})` }}
                  />
                  <div className="relative flex justify-between">
                    {nodes.map((n, i) => {
                      const active = i <= activeIdx;
                      return (
                        <div key={i} className="flex flex-col items-center gap-1.5 flex-1">
                          <div
                            className={`w-8 h-8 rounded-full border flex items-center justify-center transition-all ${
                              active
                                ? "bg-[oklch(0.62_0.28_295)] border-transparent shadow-[0_0_20px_oklch(0.62_0.28_295_/_0.7)]"
                                : "bg-[oklch(0.14_0.05_275)] border-white/15"
                            }`}
                          >
                            {i === 0 && <Wallet className="w-3.5 h-3.5 text-white" />}
                            {i === 1 && <span className="text-[10px] font-bold text-white">J</span>}
                            {i === 2 && <span className="text-[9px] font-bold text-white">$</span>}
                            {i === 3 && <Building2 className="w-3.5 h-3.5 text-white" />}
                            {i === 4 && <span className="text-xs">{current.corridor.flag}</span>}
                          </div>
                          <span
                            className={`text-[10px] font-mono ${active ? "text-white" : "text-white/40"}`}
                          >
                            {i === 4 ? current.corridor.currency : n}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Order book mini feed */}
                <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] font-mono">
                  <MiniStat label="Slippage" value="0.05%" />
                  <MiniStat label="Price impact" value="0.02%" />
                  <MiniStat
                    label="Min received"
                    value={`${fmt(current.local * 0.995, 0)} ${current.corridor.currency}`}
                  />
                </div>
              </div>
            </div>

            {/* RIGHT: Floating "people sending money" cards + stream */}
            <div className="relative p-6 md:p-8 bg-black/20 backdrop-blur overflow-hidden">
              <div className="flex items-center gap-2 mb-4">
                <span className="relative flex w-2 h-2">
                  <span className="absolute inset-0 rounded-full bg-[color:var(--success)] animate-live-dot" />
                  <span className="relative rounded-full w-2 h-2 bg-[color:var(--success)]" />
                </span>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-white/80">
                  Jupiter route preview
                </div>
              </div>

              <div className="space-y-2.5">
                {stream.map((s, i) => (
                  <div
                    key={s.id}
                    className="group relative rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] px-3.5 py-3 animate-[fade-in_0.5s_ease-out] hover:border-[oklch(0.7_0.28_330)]/40 transition"
                    style={{ opacity: 1 - i * 0.11, transform: `translateX(${i * 2}px)` }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative w-10 h-10 rounded-full shrink-0 bg-gradient-to-br from-[oklch(0.62_0.28_295)] to-[oklch(0.7_0.28_330)] shadow-[0_0_16px_oklch(0.7_0.28_330_/_0.45)] flex items-center justify-center text-white font-bold text-sm">
                        J
                        {i === 0 && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[color:var(--success)] border-2 border-[oklch(0.11_0.05_275)]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-white truncate">
                            Jupiter route preview · <span className="text-white/50">Demo mode</span>
                          </span>
                          <span className="text-[10px] text-white/40 font-mono shrink-0">demo</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[12px] font-mono">
                          <span
                            className="px-1.5 py-0.5 rounded font-semibold"
                            style={{
                              background: `${TOKEN_COLOR["SOL"]}22`,
                              color: TOKEN_COLOR["SOL"],
                            }}
                          >
                            SOL
                          </span>
                          <span className="text-white/50">→</span>
                          <span className="text-white/90">USDC · Output: connected wallet</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 text-[11px] text-white/40 font-mono leading-relaxed">
                * Illustrative route preview only — not LamportPay customer activity. Live swaps use
                the Jupiter Swap API; Fiat payout is disabled.
              </div>
            </div>
          </div>

          {/* Bottom marquee: "just sent" strip */}
          <JustSentMarquee />
        </div>
      </div>
    </section>
  );
}

function Counter({
  label,
  value,
  icon,
  sub,
  up,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  sub?: string;
  up?: boolean;
}) {
  return (
    <div className="p-4 md:p-5">
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/50 flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div
        className={`mt-1 text-xl md:text-2xl font-semibold tabular-nums ${up ? "text-uv" : "text-white"}`}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-white/40 font-mono">{sub}</div>}
    </div>
  );
}

function SwapPanel({
  label,
  token,
  amount,
  usd,
  highlight,
  flag,
}: {
  label: string;
  token: string;
  amount: string;
  usd: number;
  highlight?: boolean;
  flag?: string;
}) {
  return (
    <div
      className={`relative rounded-2xl border p-4 ${
        highlight
          ? "border-[oklch(0.7_0.28_330)]/40 bg-gradient-to-br from-[oklch(0.7_0.28_330)]/10 to-[oklch(0.62_0.28_295)]/10"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-white/50 mb-2">
        <span>{label}</span>
        <span>≈ ${fmt(usd, 2)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span
          key={amount}
          className="text-2xl md:text-3xl font-semibold tabular-nums text-white animate-[fade-in_0.35s_ease-out]"
        >
          {amount}
        </span>
        <div className="flex items-center gap-2 rounded-full bg-black/40 border border-white/10 px-3 py-1.5">
          {flag ? (
            <span className="text-lg leading-none">{flag}</span>
          ) : (
            <span
              className="w-5 h-5 rounded-full"
              style={{ background: TOKEN_COLOR[token] || "oklch(0.7 0.2 260)" }}
            />
          )}
          <span className="font-semibold text-sm text-white">{token}</span>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-2">
      <div className="text-white/40 uppercase tracking-widest text-[9px]">{label}</div>
      <div className="text-white/90 mt-0.5 truncate">{value}</div>
    </div>
  );
}

function JustSentMarquee() {
  const items = useMemo(() => Array.from({ length: 14 }, (_, i) => mkSwap(i + 40)), []);
  const loop = [...items, ...items];
  return (
    <div className="relative border-t border-white/10 bg-black/30 overflow-hidden">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-[oklch(0.11_0.05_275)] to-transparent z-10" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[oklch(0.11_0.05_275)] to-transparent z-10" />
      <div className="flex gap-6 py-3 animate-ticker whitespace-nowrap will-change-transform">
        {loop.map((s, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-2 text-[12px] font-mono text-white/70"
          >
            <CheckCircle2 className="w-3 h-3 text-[color:var(--success)]" />
            <span className="text-white/90">Jupiter route preview</span>
            <span
              className="px-1.5 rounded font-semibold"
              style={{ background: `${TOKEN_COLOR["SOL"]}22`, color: TOKEN_COLOR["SOL"] }}
            >
              SOL → USDC
            </span>
            <span className="text-white/30">·</span>
            <span className="text-white">Output: connected wallet</span>
            <span className="text-white/30">·</span>
            <span className="text-white/40">Fiat payout disabled</span>
            <span className="text-white/30">·</span>
            <span className="text-white/40">Demo mode</span>
            <span className="text-white/20">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ------- Compact floating cards for hero -------
export function HeroFloatingCards() {
  const [items, setItems] = useState<Swap[]>(() =>
    Array.from({ length: 3 }, (_, i) => mkSwap(i + 20)),
  );
  const hydrated = useHydrated();
  useEffect(() => {
    if (!hydrated) return;
    const id = setInterval(() => setItems((p) => [mkSwap(), ...p].slice(0, 3)), 2600);
    return () => clearInterval(id);
  }, [hydrated]);
  const positions = [
    "top-8 -left-2 md:left-4 rotate-[-4deg]",
    "top-1/2 -right-2 md:right-6 rotate-[3deg]",
    "bottom-6 left-1/3 rotate-[-2deg]",
  ];
  return (
    <div className="pointer-events-none absolute inset-0 hidden md:block">
      {items.map((s, i) => (
        <div
          key={s.id}
          className={`absolute ${positions[i]} w-64 rounded-2xl border border-primary/20 bg-card/90 backdrop-blur-xl shadow-[var(--shadow-soft)] p-3 animate-[fade-in_0.5s_ease-out]`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[oklch(0.62_0.28_295)] to-[oklch(0.7_0.28_330)] shadow-[0_0_14px_oklch(0.7_0.28_330_/_0.5)] flex items-center justify-center text-white font-bold text-sm">
              J
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate">Jupiter route preview</div>
              <div className="text-[10px] text-muted-foreground font-mono">Demo mode</div>
            </div>
            <span className="text-[10px] font-semibold text-[color:var(--success)] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--success)] animate-live-dot" />{" "}
              demo
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm font-mono">
            <span
              className="px-2 py-0.5 rounded font-semibold text-xs"
              style={{ background: `${TOKEN_COLOR["SOL"]}22`, color: TOKEN_COLOR["SOL"] }}
            >
              SOL
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="font-semibold">USDC</span>
          </div>
          <div className="mt-1.5 text-[10px] font-mono text-muted-foreground">
            Output: connected wallet · Fiat payout disabled
          </div>
        </div>
      ))}
    </div>
  );
}
