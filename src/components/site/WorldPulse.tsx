import { useHydrated } from "@/hooks/use-hydrated";
import { useEffect, useState } from "react";
import { CORRIDORS, TOKENS, TOKEN_USD, fmt } from "./demo-data";

// Approximate lon/lat for corridor countries + a few sender hubs
const COORDS: Record<string, [number, number]> = {
  PKR: [69, 30],
  INR: [78, 22],
  NGN: [8, 9],
  PHP: [122, 13],
  MXN: [-102, 23],
  BDT: [90, 24],
  EGP: [30, 27],
  COP: [-74, 4],
  BRL: [-52, -10],
  PEN: [-75, -10],
};
const HUBS: [number, number, string][] = [
  [-74, 40, "NYC"],
  [-0.1, 51.5, "LON"],
  [103.8, 1.3, "SGP"],
  [55.3, 25.2, "DXB"],
  [139.7, 35.7, "TYO"],
  [-122.4, 37.8, "SFO"],
  [13.4, 52.5, "BER"],
];

// Orthographic globe projection into a 600x600 viewBox (spinning earth)
const CX = 300;
const CY = 300;
const R = 230;
const TILT = 18; // deg, gives the globe a natural axial tilt
const RAD = Math.PI / 180;

/** Returns [x, y, visible] — visible=false when the point is on the far side. */
function round2(n: number) {
  // Round so SSR and browser Math implementations serialize identically.
  return Math.round(n * 100) / 100;
}

function globe(lon: number, lat: number, rot: number): [number, number, boolean] {
  const la = lat * RAD;
  const lo = (lon + rot) * RAD;
  const t = TILT * RAD;
  const x0 = Math.cos(la) * Math.sin(lo);
  const y0 = Math.sin(la);
  const z0 = Math.cos(la) * Math.cos(lo);
  // tilt around the x-axis
  const y = y0 * Math.cos(t) - z0 * Math.sin(t);
  const z = y0 * Math.sin(t) + z0 * Math.cos(t);
  return [round2(CX + R * x0), round2(CY - R * y), z > 0.02];
}

function arcPath(a: [number, number], b: [number, number]) {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const mx = round2((x1 + x2) / 2);
  const my = round2((y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.35);
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

// Sparse dot-matrix continents (hand-tuned lon/lat blobs). Cheap, no map lib.
const CONTINENT_BLOBS: [number, number, number][] = [
  // [lon, lat, radiusDeg]
  [-100, 45, 22],
  [-90, 32, 14],
  [-75, 10, 10],
  [-60, -15, 22],
  [-70, -35, 8],
  [10, 50, 18],
  [20, 30, 14],
  [25, 5, 14],
  [25, -10, 14],
  [28, -28, 10],
  [45, 55, 18],
  [80, 45, 20],
  [100, 30, 18],
  [115, 20, 10],
  [130, -5, 10],
  [135, -25, 12],
  [140, 60, 14],
];
function inLand(lon: number, lat: number) {
  return CONTINENT_BLOBS.some(([blon, blat, r]) => {
    const dx = lon - blon;
    const dy = lat - blat;
    return dx * dx + dy * dy < r * r;
  });
}
const LAND_POINTS: [number, number][] = [];
for (let lat = -55; lat <= 75; lat += 4) {
  for (let lon = -180; lon < 180; lon += 4) {
    if (inLand(lon, lat)) LAND_POINTS.push([lon, lat]);
  }
}

type Flight = {
  id: number;
  from: [number, number];
  to: [number, number];
  token: string;
  amount: number;
  currency: string;
  city: string;
};

let flightSeq = 0;
// Deterministic PRNG for the initial render so SSR markup matches the client.
function seeded(i: number) {
  let s = (i * 1664525 + 1013904223) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeFlight(seed?: number): Flight {
  const r = seed === undefined ? Math.random : seeded(seed + 1);
  const hub = HUBS[Math.floor(r() * HUBS.length)];
  const corr = CORRIDORS[Math.floor(r() * CORRIDORS.length)];
  const token = TOKENS[Math.floor(r() * TOKENS.length)];
  const amount = Math.round(50 + r() * 4950);
  return {
    id: seed === undefined ? ++flightSeq : -(seed + 1),
    from: [hub[0], hub[1]],
    to: [COORDS[corr.currency][0], COORDS[corr.currency][1]],
    token,
    amount,
    currency: corr.currency,
    city: hub[2],
  };
}

export function WorldPulse() {
  const [flights, setFlights] = useState<Flight[]>(() =>
    Array.from({ length: 5 }, (_, i) => makeFlight(i)),
  );
  const [feed, setFeed] = useState<Flight[]>(() =>
    Array.from({ length: 4 }, (_, i) => makeFlight(i + 10)),
  );
  const [rot, setRot] = useState(0);
  const hydrated = useHydrated();

  useEffect(() => {
    if (!hydrated) return;
    // ~20fps spin, one full rotation every ~55s
    const id = setInterval(() => setRot((r) => (r + 0.32) % 360), 50);
    return () => clearInterval(id);
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const id = setInterval(() => {
      const f = makeFlight();
      setFlights((prev) => [...prev.slice(-6), f]);
      setFeed((prev) => [f, ...prev].slice(0, 5));
    }, 1400);
    return () => clearInterval(id);
  }, [hydrated]);

  return (
    <section className="mt-32">
      <div className="max-w-7xl mx-auto px-5">
        <div className="text-center max-w-3xl mx-auto">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">
            Global Payment Mesh · AI-routed
          </div>
          <h2 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight">
            Jupiter-powered swap demo — built for future payout routing.
          </h2>
          <p className="mt-3 text-muted-foreground">
            This demo shows how a Solana wallet can swap SOL to USDC through Jupiter. Local-currency
            payout remains disabled until licensed partner approval.
          </p>
        </div>

        <div className="mt-10 relative rounded-3xl border border-primary/25 bg-[oklch(0.13_0.05_275)] text-white overflow-hidden shadow-[var(--shadow-elegant)]">
          <div className="absolute inset-0 bg-grid-uv opacity-70 pointer-events-none" />
          <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[oklch(0.6_0.28_295)] opacity-30 blur-3xl animate-uv-pulse pointer-events-none" />
          <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-[oklch(0.7_0.22_200)] opacity-25 blur-3xl animate-uv-pulse pointer-events-none" />

          <div className="relative grid lg:grid-cols-[1fr_320px] gap-0">
            <div className="relative p-4 md:p-6">
              <svg viewBox="0 0 600 600" className="w-full h-auto max-h-[540px] mx-auto">
                <defs>
                  <linearGradient id="arc" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stopColor="oklch(0.82 0.18 200)" stopOpacity="0" />
                    <stop offset="50%" stopColor="oklch(0.82 0.18 200)" stopOpacity="1" />
                    <stop offset="100%" stopColor="oklch(0.7 0.28 330)" stopOpacity="1" />
                  </linearGradient>
                  <radialGradient id="node" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="oklch(0.82 0.18 200)" stopOpacity="1" />
                    <stop offset="100%" stopColor="oklch(0.82 0.18 200)" stopOpacity="0" />
                  </radialGradient>
                  <radialGradient id="ocean" cx="35%" cy="30%" r="80%">
                    <stop offset="0%" stopColor="oklch(0.35 0.12 265)" stopOpacity="0.9" />
                    <stop offset="70%" stopColor="oklch(0.18 0.08 275)" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="oklch(0.11 0.05 280)" stopOpacity="1" />
                  </radialGradient>
                  <radialGradient id="atmo" cx="50%" cy="50%" r="50%">
                    <stop offset="82%" stopColor="oklch(0.7 0.22 250)" stopOpacity="0" />
                    <stop offset="97%" stopColor="oklch(0.75 0.22 250)" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="oklch(0.75 0.22 250)" stopOpacity="0" />
                  </radialGradient>
                  <clipPath id="globeClip">
                    <circle cx={CX} cy={CY} r={R} />
                  </clipPath>
                </defs>

                {/* atmosphere + ocean sphere */}
                <circle cx={CX} cy={CY} r={R + 26} fill="url(#atmo)" />
                <circle
                  cx={CX}
                  cy={CY}
                  r={R}
                  fill="url(#ocean)"
                  stroke="oklch(0.7 0.2 250 / 0.4)"
                  strokeWidth="1"
                />

                {/* graticule */}
                <g
                  clipPath="url(#globeClip)"
                  opacity="0.28"
                  stroke="oklch(0.8 0.12 250 / 0.5)"
                  fill="none"
                >
                  {[-60, -30, 0, 30, 60].map((lat) => {
                    const t = TILT * RAD;
                    const la = lat * RAD;
                    return (
                      <ellipse
                        key={lat}
                        cx={CX}
                        cy={CY - R * Math.sin(la) * Math.cos(t)}
                        rx={R * Math.cos(la)}
                        ry={Math.abs(R * Math.cos(la) * Math.sin(t)) + 0.4}
                        strokeWidth="0.6"
                      />
                    );
                  })}
                  {[0, 30, 60, 90, 120, 150].map((lon) => {
                    const phase = ((lon + rot) % 180) * RAD;
                    return (
                      <ellipse
                        key={lon}
                        cx={CX}
                        cy={CY}
                        rx={Math.abs(R * Math.cos(phase))}
                        ry={R}
                        strokeWidth="0.6"
                        transform={`rotate(${TILT} ${CX} ${CY})`}
                      />
                    );
                  })}
                </g>

                {/* landmass dots on the rotating sphere */}
                <g clipPath="url(#globeClip)">
                  {LAND_POINTS.map(([lon, lat], i) => {
                    const [x, y, vis] = globe(lon, lat, rot);
                    if (!vis) return null;
                    return <circle key={i} cx={x} cy={y} r="1.5" fill="oklch(0.8 0.1 260 / 0.5)" />;
                  })}
                </g>

                {/* hub nodes */}
                {HUBS.map(([lon, lat, name]) => {
                  const [x, y, vis] = globe(lon, lat, rot);
                  if (!vis) return null;
                  return (
                    <g key={name}>
                      <circle cx={x} cy={y} r="14" fill="url(#node)" opacity="0.5" />
                      <circle cx={x} cy={y} r="3" fill="oklch(0.85 0.18 200)" />
                      <text
                        x={x + 8}
                        y={y - 6}
                        fill="oklch(0.85 0.18 200)"
                        fontSize="10"
                        fontFamily="ui-monospace, monospace"
                      >
                        {name}
                      </text>
                    </g>
                  );
                })}

                {/* corridor destinations */}
                {CORRIDORS.map((c) => {
                  const [lon, lat] = COORDS[c.currency];
                  const [x, y, vis] = globe(lon, lat, rot);
                  if (!vis) return null;
                  return (
                    <g key={c.currency}>
                      <circle cx={x} cy={y} r="10" fill="oklch(0.7 0.28 330 / 0.25)">
                        {hydrated && (
                          <>
                            <animate
                              attributeName="r"
                              values="8;16;8"
                              dur="2.4s"
                              repeatCount="indefinite"
                            />
                            <animate
                              attributeName="opacity"
                              values="0.5;0;0.5"
                              dur="2.4s"
                              repeatCount="indefinite"
                            />
                          </>
                        )}
                      </circle>
                      <circle cx={x} cy={y} r="3.5" fill="oklch(0.78 0.24 340)" />
                      <text
                        x={x + 7}
                        y={y + 12}
                        fill="oklch(0.9 0.05 320)"
                        fontSize="10"
                        fontFamily="ui-monospace, monospace"
                      >
                        {c.currency}
                      </text>
                    </g>
                  );
                })}

                {/* flight arcs */}
                {flights.map((f) => {
                  const [ax, ay, av] = globe(f.from[0], f.from[1], rot);
                  const [bx, by, bv] = globe(f.to[0], f.to[1], rot);
                  if (!av || !bv) return null;
                  const d = arcPath([ax, ay], [bx, by]);
                  return (
                    <g key={f.id}>
                      <path
                        d={d}
                        stroke="url(#arc)"
                        strokeWidth="1.5"
                        fill="none"
                        strokeDasharray="6 6"
                        opacity="0.8"
                      >
                        {hydrated && (
                          <animate
                            attributeName="stroke-dashoffset"
                            from="120"
                            to="0"
                            dur="2.2s"
                            repeatCount="indefinite"
                          />
                        )}
                      </path>
                      <circle r="3" fill="oklch(0.92 0.2 200)">
                        {hydrated && <animateMotion dur="2.2s" repeatCount="indefinite" path={d} />}
                      </circle>
                    </g>
                  );
                })}
              </svg>

              {/* Floating coin chips */}
              <div className="pointer-events-none absolute inset-0">
                {TOKENS.map((t, i) => {
                  const positions = [
                    "top-4 left-6",
                    "top-10 right-8",
                    "bottom-8 left-10",
                    "bottom-14 right-14",
                    "top-1/2 left-4",
                    "top-1/3 right-6",
                    "bottom-4 left-1/2",
                  ];
                  return (
                    <div
                      key={t}
                      className={`absolute ${positions[i]} rounded-full border border-white/15 bg-white/5 backdrop-blur px-3 py-1 text-[11px] font-mono text-white/90 flex items-center gap-1.5 animate-uv-pulse`}
                      style={{ animationDelay: `${i * 0.35}s` }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.82_0.18_200)] shadow-[0_0_8px_oklch(0.82_0.18_200)]" />
                      {t}
                      <span className="text-white/50">
                        ${fmt(TOKEN_USD[t], TOKEN_USD[t] < 1 ? 4 : 2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live feed */}
            <div className="relative border-t lg:border-t-0 lg:border-l border-white/10 p-5 md:p-6 bg-black/20 backdrop-blur">
              <div className="flex items-center gap-2 mb-4">
                <span className="relative flex w-2 h-2">
                  <span className="absolute inset-0 rounded-full bg-[color:var(--success)] animate-live-dot" />
                  <span className="relative rounded-full w-2 h-2 bg-[color:var(--success)]" />
                </span>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-white/80">
                  Simulated route preview
                </div>
              </div>
              <ul className="space-y-2.5">
                {feed.map((f, idx) => (
                  <li
                    key={f.id}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm animate-[fade-in_0.4s_ease-out]"
                    style={{ opacity: 1 - idx * 0.14 }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-white/90">SOL → USDC route preview</span>
                      <span className="text-uv font-semibold text-xs">Demo</span>
                    </div>
                    <div className="text-[11px] text-white/50 mt-0.5 font-mono">
                      Demo preview only · Output: connected wallet
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-5 text-[11px] text-white/40 font-mono leading-relaxed">
                * Simulated route preview. Demo values only. No payout is executed.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
