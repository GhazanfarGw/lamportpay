import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { useHydrated } from "@/hooks/use-hydrated";

const CITIES = [
  { name: "Karachi", tz: "PKT", cur: "PKR", lat: 24.86, lon: 67.01 },
  { name: "Mumbai", tz: "IST", cur: "INR", lat: 19.07, lon: 72.87 },
  { name: "Lagos", tz: "WAT", cur: "NGN", lat: 6.5, lon: 3.37 },
  { name: "Manila", tz: "PHT", cur: "PHP", lat: 14.6, lon: 120.98 },
  { name: "Mexico City", tz: "CST", cur: "MXN", lat: 19.43, lon: -99.13 },
  { name: "Dhaka", tz: "BST", cur: "BDT", lat: 23.81, lon: 90.41 },
  { name: "Cairo", tz: "EET", cur: "EGP", lat: 30.04, lon: 31.24 },
  { name: "São Paulo", tz: "BRT", cur: "BRL", lat: -23.55, lon: -46.63 },
  { name: "Bogotá", tz: "COT", cur: "COP", lat: 4.71, lon: -74.07 },
  { name: "Lima", tz: "PET", cur: "PEN", lat: -12.05, lon: -77.04 },
  { name: "Jakarta", tz: "WIB", cur: "IDR", lat: -6.2, lon: 106.85 },
  { name: "Nairobi", tz: "EAT", cur: "KES", lat: -1.29, lon: 36.82 },
];

function nowInCity(offsetH: number) {
  const d = new Date(Date.now() + offsetH * 3600 * 1000);
  return d.toUTCString().slice(17, 22);
}

const OFFSETS: Record<string, number> = {
  PKT: 5,
  IST: 5.5,
  WAT: 1,
  PHT: 8,
  CST: -6,
  BST: 6,
  EET: 2,
  BRT: -3,
  COT: -5,
  PET: -5,
  WIB: 7,
  EAT: 3,
};

export function CitiesNeverSleep() {
  const [tick, setTick] = useState(0);
  const hydrated = useHydrated();
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="relative mt-32 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid-uv opacity-40" />
        <div className="absolute top-1/2 left-1/4 w-[600px] h-[600px] rounded-full bg-[oklch(0.62_0.28_295)] opacity-10 blur-3xl animate-uv-pulse" />
        <div className="absolute top-10 right-10 w-[500px] h-[500px] rounded-full bg-[oklch(0.82_0.18_200)] opacity-10 blur-3xl animate-uv-pulse" />
      </div>

      <div className="max-w-7xl mx-auto px-5">
        <div className="text-center max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-card/70 backdrop-blur px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-[color:var(--success)] animate-live-dot" />
              <span className="relative rounded-full w-1.5 h-1.5 bg-[color:var(--success)]" />
            </span>
            Cities never sleep
          </div>
          <h2 className="mt-4 text-3xl md:text-4xl font-semibold tracking-tight">
            A demo built for <span className="text-uv">a future payout flow.</span>
          </h2>
          <p className="mt-3 text-muted-foreground">
            LamportPay currently demonstrates wallet connection and Jupiter SOL-to-USDC swap
            routing. Corridor payouts are not live.
          </p>
        </div>

        <div className="mt-12 grid gap-3 md:grid-cols-3 lg:grid-cols-4" key={tick}>
          {CITIES.map((c, i) => {
            // Clocks are time-dependent: render a stable placeholder until hydration.
            const t = hydrated ? nowInCity(OFFSETS[c.tz] ?? 0) : "--:--";
            const active = (tick + i) % 5 < 3;
            return (
              <div
                key={c.name}
                className="group relative rounded-2xl border border-border/60 bg-card/80 backdrop-blur p-4 overflow-hidden hover:border-primary/40 transition"
              >
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--neon-cyan)] to-transparent opacity-60" />
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">
                      {c.tz} · {c.cur}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-lg tabular-nums text-primary">{t}</div>
                    <div
                      className={`text-[10px] uppercase font-semibold mt-0.5 ${active ? "text-[color:var(--success)]" : "text-muted-foreground"}`}
                    >
                      {active ? "● routing" : "○ idle"}
                    </div>
                  </div>
                </div>
                <div className="mt-3 h-1 rounded-full bg-secondary overflow-hidden relative">
                  <div
                    className="absolute inset-y-0 bg-[image:var(--gradient-uv)] rounded-full"
                    style={{
                      width: `${20 + ((tick + i * 3) % 80)}%`,
                      transition: "width 900ms ease",
                    }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                  <span className="flex items-center gap-1">
                    <Zap className="w-3 h-3 text-[color:var(--neon-cyan)]" />
                    {((tick + i * 7) % 40) + 12} tx/min
                  </span>
                  <span>~{((i * 23) % 90) + 30}s settle</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border border-border/60 bg-card/60 backdrop-blur px-4 py-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[11px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--success)] animate-live-dot" />
            DEMO MODE
          </span>
          <span>JUPITER ROUTE PREVIEW</span>
          <span>SOL → USDC</span>
          <span>OUTPUT: CONNECTED WALLET</span>
          <span className="text-[color:var(--neon-cyan)]">FIAT PAYOUT DISABLED</span>
        </div>
      </div>
    </section>
  );
}
