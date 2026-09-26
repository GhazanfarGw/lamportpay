import { useEffect, useState } from "react";

/**
 * Lammy — LamportPay's original AI Transfer Assistant mascot.
 * Pure SVG, no external art. Soft rounded head, glowing eyes,
 * blue/violet/silver palette, blinking + floating + optional wave.
 */
export function Lammy({
  size = 72,
  wave = false,
  float = true,
  className = "",
}: {
  size?: number;
  wave?: boolean;
  float?: boolean;
  className?: string;
}) {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(
        () => {
          setBlink(true);
          setTimeout(() => setBlink(false), 130);
          loop();
        },
        2600 + Math.random() * 2600,
      );
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={(float ? "animate-lammy-float " : "") + className}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        role="img"
        aria-label="Lammy, the LamportPay AI assistant"
      >
        <defs>
          <linearGradient id="lammy-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.98 0.01 275)" />
            <stop offset="55%" stopColor="oklch(0.90 0.03 275)" />
            <stop offset="100%" stopColor="oklch(0.78 0.05 280)" />
          </linearGradient>
          <linearGradient id="lammy-visor" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.42 0.16 275)" />
            <stop offset="100%" stopColor="oklch(0.32 0.14 300)" />
          </linearGradient>
          <linearGradient id="lammy-uv" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.72 0.19 235)" />
            <stop offset="100%" stopColor="oklch(0.62 0.28 295)" />
          </linearGradient>
          <filter id="lammy-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* soft aura */}
        <ellipse cx="60" cy="62" rx="46" ry="44" fill="url(#lammy-uv)" opacity="0.16" />

        {/* antenna */}
        <line
          x1="60"
          y1="24"
          x2="60"
          y2="14"
          stroke="oklch(0.78 0.05 280)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle
          cx="60"
          cy="11"
          r="4.5"
          fill="url(#lammy-uv)"
          filter="url(#lammy-glow)"
          className="animate-lammy-pulse"
        />

        {/* head */}
        <rect
          x="18"
          y="24"
          width="84"
          height="70"
          rx="30"
          fill="url(#lammy-body)"
          stroke="oklch(0.72 0.06 285)"
          strokeWidth="1.5"
        />

        {/* visor */}
        <rect x="29" y="38" width="62" height="40" rx="20" fill="url(#lammy-visor)" />
        <rect x="29" y="38" width="62" height="18" rx="14" fill="#ffffff" opacity="0.07" />

        {/* eyes */}
        <g filter="url(#lammy-glow)">
          <ellipse cx="48" cy="58" rx="6" ry={blink ? 0.9 : 6.6} fill="oklch(0.86 0.16 210)" />
          <ellipse cx="72" cy="58" rx="6" ry={blink ? 0.9 : 6.6} fill="oklch(0.86 0.16 210)" />
        </g>
        {!blink && (
          <>
            <circle cx="46" cy="55.5" r="1.8" fill="#fff" opacity="0.9" />
            <circle cx="70" cy="55.5" r="1.8" fill="#fff" opacity="0.9" />
          </>
        )}

        {/* calm smile */}
        <path
          d="M52 70 Q60 75 68 70"
          stroke="oklch(0.86 0.16 210)"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
          opacity="0.75"
        />

        {/* ear modules */}
        <rect x="12" y="50" width="8" height="18" rx="4" fill="oklch(0.80 0.05 285)" />
        <rect x="100" y="50" width="8" height="18" rx="4" fill="oklch(0.80 0.05 285)" />

        {/* shoulders */}
        <path
          d="M30 112 Q30 94 60 94 Q90 94 90 112 Z"
          fill="url(#lammy-body)"
          stroke="oklch(0.72 0.06 285)"
          strokeWidth="1.5"
        />
        <rect x="52" y="100" width="16" height="4" rx="2" fill="url(#lammy-uv)" opacity="0.8" />

        {/* waving hand */}
        {wave && (
          <g className="animate-lammy-wave" style={{ transformOrigin: "96px 92px" }}>
            <rect
              x="90"
              y="86"
              width="7"
              height="16"
              rx="3.5"
              fill="oklch(0.80 0.05 285)"
              transform="rotate(-24 93 94)"
            />
            <circle
              cx="99"
              cy="83"
              r="7.5"
              fill="url(#lammy-body)"
              stroke="oklch(0.72 0.06 285)"
              strokeWidth="1.2"
            />
          </g>
        )}
      </svg>
    </div>
  );
}

export function LammyTyping() {
  return (
    <span className="inline-flex items-center gap-1 align-middle" aria-label="Lammy is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-primary animate-lammy-dot"
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </span>
  );
}

export function LammyCheck({ label = "Step complete" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--success)]">
      <span className="w-5 h-5 rounded-full border-2 border-[color:var(--success)] flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5">
          <path
            d="M4 12.5 L9.5 18 L20 6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-lammy-check"
          />
        </svg>
      </span>
      {label}
    </span>
  );
}

/** Standard speech-bubble block used across the site. */
export function LammySays({
  children,
  size = 64,
  wave = false,
  typing = false,
  tone = "default",
  className = "",
}: {
  children: React.ReactNode;
  size?: number;
  wave?: boolean;
  typing?: boolean;
  tone?: "default" | "warning";
  className?: string;
}) {
  const accent =
    tone === "warning"
      ? "border-[color:var(--warning)]/40 bg-[color:var(--warning)]/5"
      : "border-border/60 bg-[image:var(--gradient-card)]";
  return (
    <div className={`flex items-start gap-4 rounded-2xl border p-4 md:p-5 ${accent} ${className}`}>
      <Lammy size={size} wave={wave} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
          Lammy · AI Transfer Assistant
          <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--success)] animate-live-dot" />
        </div>
        <div className="mt-1.5 text-sm md:text-[15px] leading-relaxed text-foreground/90">
          {children} {typing && <LammyTyping />}
        </div>
      </div>
    </div>
  );
}

export const LAMMY_INTRO =
  "Hi, I’m Lammy. I help explain your transfer, fees, wallet safety, and payout steps.";
export const LAMMY_SAFETY = "Lammy will never ask for your seed phrase or private key.";
