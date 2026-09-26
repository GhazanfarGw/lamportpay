import { useMemo } from "react";
import { CheckCircle2, Globe2, ShieldCheck, Route } from "lucide-react";

const PEOPLE = [
  { name: "Jupiter route preview", city: "Demo mode", corridor: "SOL → USDC" },
  { name: "Output: connected wallet", city: "No custody", corridor: "SOL → USDC" },
  { name: "Fiat payout disabled", city: "Fiat off", corridor: "SOL → USDC" },
  { name: "Built using Jupiter Swap API", city: "Solana", corridor: "SOL → USDC" },
  { name: "Best-route scan", city: "Liquidity sources", corridor: "SOL → USDC" },
  { name: "Test amount 0.001 SOL", city: "Limit 0.01 SOL", corridor: "SOL → USDC" },
  { name: "Slippage checked", city: "Pre-sign review", corridor: "SOL → USDC" },
  { name: "Signed in your wallet", city: "You approve", corridor: "SOL → USDC" },
  { name: "KYC disabled", city: "Demo only", corridor: "SOL → USDC" },
  { name: "No user funds held", city: "Non-custodial", corridor: "SOL → USDC" },
  { name: "On-chain receipt", city: "Solscan link", corridor: "SOL → USDC" },
  { name: "Mock fiat payout demo", city: "/send", corridor: "SOL → USDC" },
];

type Person = (typeof PEOPLE)[number];

function row(offset: number): Person[] {
  return PEOPLE.map((_, i) => PEOPLE[(i + offset) % PEOPLE.length]);
}

function AvatarCard({ p }: { p: Person }) {
  return (
    <div className="group flex items-center gap-3 shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur px-3 py-2.5 pr-5 hover:border-[color:var(--neon-violet)]/50 hover:bg-white/[0.07] transition-colors">
      <div className="relative">
        <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-[color:var(--neon-violet)] to-[color:var(--neon-magenta)] opacity-60 blur-[3px] group-hover:opacity-100 transition-opacity" />
        <div className="relative w-11 h-11 rounded-full border border-white/20 bg-[oklch(0.16_0.06_275)] flex items-center justify-center">
          <Route className="w-5 h-5 text-white/80" />
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[color:var(--success)] border-2 border-[oklch(0.09_0.04_275)] flex items-center justify-center">
          <CheckCircle2 className="w-2.5 h-2.5 text-black" strokeWidth={3.5} />
        </span>
      </div>
      <div className="leading-tight">
        <div className="text-sm text-white/90 font-medium whitespace-nowrap">{p.name}</div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-white/45 whitespace-nowrap">
          {p.city} · {p.corridor}
        </div>
      </div>
    </div>
  );
}

function Rail({ people, dir }: { people: Person[]; dir: "left" | "right" }) {
  const doubled = [...people, ...people];
  return (
    <div className="overflow-hidden">
      <div
        className={`flex gap-3 w-max ${dir === "left" ? "animate-rail-left" : "animate-rail-right"}`}
      >
        {doubled.map((p, i) => (
          <AvatarCard key={i} p={p} />
        ))}
      </div>
    </div>
  );
}

export function VerifiedUsers() {
  const rows = useMemo(() => [row(0), row(3), row(6)], []);
  return (
    <section className="relative mt-24 md:mt-32 overflow-hidden">
      <div className="absolute inset-0 bg-[oklch(0.09_0.04_275)]" />
      <div className="absolute inset-0 bg-grid-uv opacity-40" />
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-background to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
      <div className="absolute left-1/2 top-1/3 -translate-x-1/2 w-[720px] h-[720px] rounded-full bg-[oklch(0.62_0.28_295)] opacity-20 blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-5 py-24 md:py-32">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-white/70 border border-white/10 rounded-full px-3 py-1.5 bg-black/40 backdrop-blur">
            <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--success)] animate-live-dot" />
            Jupiter-powered SOL → USDC swap demo
          </div>
          <h2 className="mt-6 text-6xl md:text-8xl font-semibold tracking-tight text-white tabular-nums">
            <span className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-transparent">
              SOL <span className="text-uv">→</span> USDC
            </span>
          </h2>
          <div className="mt-3 text-sm md:text-base text-white/60 flex items-center justify-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[color:var(--success)]" />
            Built using the Jupiter Swap API · output returns to your connected wallet
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-[11px] font-mono uppercase tracking-widest text-white/50">
            <span className="flex items-center gap-1.5">
              <Globe2 className="w-3.5 h-3.5" /> Demo mode
            </span>
            <span className="w-1 h-1 rounded-full bg-white/30" />
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[color:var(--success)]" /> Partner payout
              disabled
            </span>
            <span className="w-1 h-1 rounded-full bg-white/30" />
            <span>No custody of funds</span>
          </div>
        </div>

        {/* Scrolling verified-sender rails */}
        <div className="rail-group relative mt-14 md:mt-20 space-y-3 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
          <Rail people={rows[0]} dir="left" />
          <Rail people={rows[1]} dir="right" />
          <Rail people={rows[2]} dir="left" />
        </div>
      </div>
    </section>
  );
}
