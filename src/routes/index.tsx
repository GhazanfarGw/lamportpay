import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/Layout";
import { TransferSimulator } from "@/components/site/TransferSimulator";
import { LiveRatesTicker, StatsStrip } from "@/components/site/LiveRates";
import { WorldPulse } from "@/components/site/WorldPulse";
import { LiveSwapTheater } from "@/components/site/LiveSwapTheater";
import { CitiesNeverSleep } from "@/components/site/CitiesNeverSleep";
import { VerifiedUsers } from "@/components/site/VerifiedUsers";
import {
  Lammy,
  LammySays,
  LammyTyping,
  LammyCheck,
  LAMMY_INTRO,
  LAMMY_SAFETY,
} from "@/components/site/Lammy";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Coins,
  FileText,
  Globe2,
  Sparkles,
  ShieldCheck,
  Zap,
  Info,
  AlertTriangle,
} from "lucide-react";
import { useState } from "react";
import { pageSeo } from "@/lib/seo";
import { FurtherReading } from "@/components/site/blog/FurtherReading";

export const Route = createFileRoute("/")({
  head: () =>
    pageSeo({
      path: "/",
      title: "LamportPay — Crypto in. Local money out.",
      description:
        "Send crypto, the recipient receives local currency. LamportPay is a Solana-first crypto-to-local-currency payment routing demo with a live SOL to USDC swap leg.",
    }),
  component: Index,
});

function Index() {
  return (
    <SiteLayout>
      <LiveRatesTicker />
      <Hero />
      <TrustStrip />
      <section className="max-w-7xl mx-auto px-5 -mt-4 md:-mt-10">
        <TransferSimulator />
      </section>
      <LiveSwapTheater />
      <VerifiedUsers />
      <section className="max-w-7xl mx-auto px-5 mt-16 md:mt-24">
        <StatsStrip />
      </section>
      <WorldPulse />
      <WhySection />
      <CitiesNeverSleep />
      <HowItWorksSection />
      <AIAssistant />
      <FeeExplainer />
      <SafetyAssistant />
      <FinalCTA />
      <FurtherReading slugs={["crypto-to-fiat-payments-explained", "why-stablecoins-settle-cross-border-payments", "solana-payments-for-developers"]} />
    </SiteLayout>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden pt-16 md:pt-24 pb-24 md:pb-32">
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid-uv opacity-70" />
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] rounded-full bg-[image:var(--gradient-hero)] opacity-20 blur-3xl animate-uv-pulse" />
        <div className="absolute top-1/3 left-10 w-72 h-72 rounded-full bg-[oklch(0.7_0.28_330)] opacity-15 blur-3xl animate-uv-pulse" />
        <div className="absolute top-10 right-10 w-72 h-72 rounded-full bg-[oklch(0.75_0.2_200)] opacity-15 blur-3xl animate-uv-pulse" />
      </div>

      <div className="relative max-w-7xl mx-auto px-5 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-card/60 backdrop-blur px-4 py-1.5 text-xs font-medium text-muted-foreground mb-6 shadow-[0_0_30px_-8px_oklch(0.62_0.28_295_/_0.45)]">
          <span className="relative flex w-2 h-2">
            <span className="absolute inset-0 rounded-full bg-[color:var(--success)] animate-live-dot" />
            <span className="relative rounded-full w-2 h-2 bg-[color:var(--success)]" />
          </span>
          <Sparkles className="w-3.5 h-3.5 text-primary" /> Solana-first routing · Demo mode ·
          Jupiter swap preview
        </div>
        <h1 className="text-5xl md:text-7xl font-semibold tracking-tight leading-[1.03] max-w-4xl mx-auto">
          Send crypto.
          <br />
          <span className="text-uv">Recipient receives local currency.</span>
        </h1>
        <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          LamportPay helps users pay with supported crypto assets, settle through USDC, and route
          local-currency payout requests through licensed settlement partners.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/swap"
            className="inline-flex items-center gap-2 rounded-full bg-[image:var(--gradient-hero)] text-white px-6 py-3 font-semibold shadow-[var(--shadow-elegant)] hover:opacity-95 transition"
          >
            Try SOL → USDC Swap Demo <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to="/pay"
            className="inline-flex items-center gap-2 rounded-full bg-card border border-border px-6 py-3 font-semibold hover:bg-secondary transition"
          >
            Send a payment
          </Link>
          <Link
            to="/whitepaper"
            className="inline-flex items-center gap-2 rounded-full bg-card border border-border px-6 py-3 font-semibold hover:bg-secondary transition"
          >
            Read White Paper
          </Link>
        </div>
        <div className="mt-8 max-w-3xl mx-auto rounded-2xl border border-[color:var(--warning)]/30 bg-card/70 backdrop-blur px-5 py-4 text-sm text-muted-foreground flex items-start gap-2.5 text-left">
          <AlertTriangle className="w-4 h-4 text-[color:var(--warning)] shrink-0 mt-0.5" />
          <span>
            Current demo: small real Jupiter SOL-to-USDC swap only. USDC returns to the connected
            wallet. LamportPay does not custody funds. Fiat payout remains disabled.
          </span>
        </div>
      </div>
    </section>
  );
}

function TrustStrip() {
  const items = [
    "Jupiter-powered SOL → USDC swap demo",
    "Output returns to your wallet",
    "Fiat payout disabled",
  ];
  return (
    <div className="max-w-7xl mx-auto px-5">
      <div className="rounded-2xl border border-border/60 bg-card/70 backdrop-blur px-4 py-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs md:text-sm text-muted-foreground">
        {items.map((i, idx) => (
          <span key={i} className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary" /> {i}
            {idx < items.length - 1 && <span className="hidden md:inline text-border">·</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function WhySection() {
  const items = [
    {
      icon: Zap,
      title: "Fast crypto checkout",
      desc: "Pay in seconds using supported Solana assets or stablecoins.",
      stat: "~400ms",
      statLabel: "avg swap",
    },
    {
      icon: Coins,
      title: "USDC settlement",
      desc: "Every transfer routes through USDC for stable, predictable value.",
      stat: "1:1",
      statLabel: "peg",
    },
    {
      icon: Globe2,
      title: "Partner-first partner flow",
      desc: "Partner-style payout flow is shown as a mock placeholder. Real Fiat payout is disabled until partner approval.",
      stat: "10+",
      statLabel: "corridors",
    },
    {
      icon: Bot,
      title: "AI transfer assistant",
      desc: "Type what you want to send — the assistant sets up the transfer.",
      stat: "24/7",
      statLabel: "online",
    },
    {
      icon: FileText,
      title: "Local-currency payouts",
      desc: "Payouts go bank to bank, into the recipient's own account.",
      stat: "Bank",
      statLabel: "payouts",
    },
    {
      icon: ShieldCheck,
      title: "Compliance-aware design",
      desc: "Partner-led KYC, no custody, no direct money transmission.",
      stat: "0",
      statLabel: "custody",
    },
  ];
  return (
    <section className="relative mt-32 overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-grid-uv opacity-30" />
      <div className="max-w-7xl mx-auto px-5">
        <SectionHead
          eyebrow="Why LamportPay"
          title="Built for a future payout flow, starting with a Jupiter swap demo."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map(({ icon: Icon, title, desc, stat, statLabel }) => (
            <div
              key={title}
              className="group relative rounded-2xl p-6 bg-card/80 backdrop-blur border border-border/60 hover:border-primary/40 hover:shadow-[var(--shadow-neon)] transition overflow-hidden"
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--neon-violet)] to-transparent opacity-0 group-hover:opacity-100 transition" />
              <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-[image:var(--gradient-uv)] opacity-0 group-hover:opacity-20 blur-2xl transition" />
              <div className="flex items-start justify-between">
                <div className="w-11 h-11 rounded-xl bg-[image:var(--gradient-uv)] text-white flex items-center justify-center mb-4 shadow-[0_0_20px_-4px_oklch(0.62_0.28_295_/_0.6)]">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="text-right">
                  <div className="font-mono text-lg font-semibold text-primary tabular-nums">
                    {stat}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {statLabel}
                  </div>
                </div>
              </div>
              <h3 className="font-semibold text-lg">{title}</h3>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    { t: "Choose crypto", sub: "SOL · USDC · JUP" },
    { t: "View mock payout quote", sub: "Mock FX + fees" },
    { t: "Mock KYC step", sub: "Demo only" },
    { t: "Settle through USDC", sub: "On-chain, ~1s" },
    { t: "Mock payout placeholder", sub: "Payout disabled" },
    { t: "Track receipt", sub: "Real-time hash" },
  ];
  return (
    <section className="relative mt-32 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[300px] rounded-full bg-[image:var(--gradient-hero)] opacity-[0.06] blur-3xl" />
      </div>
      <div className="max-w-7xl mx-auto px-5">
        <SectionHead
          eyebrow="How it works"
          title="Simple, transparent demo flow — from wallet swap to mock payout preview."
        />
        <div className="mt-12 relative">
          <div className="hidden lg:block absolute top-8 left-[8%] right-[8%] h-px bg-gradient-to-r from-transparent via-[color:var(--neon-violet)] to-transparent" />
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            {steps.map((s, i) => (
              <div
                key={s.t}
                className="relative rounded-2xl p-5 bg-card/80 backdrop-blur border border-border/60 hover:border-primary/40 transition group"
              >
                <div className="w-8 h-8 rounded-full bg-[image:var(--gradient-uv)] text-white text-xs font-bold flex items-center justify-center mb-3 shadow-[0_0_16px_-4px_oklch(0.62_0.28_295_/_0.6)]">
                  {i + 1}
                </div>
                <div className="font-medium leading-snug text-sm">{s.t}</div>
                <div className="mt-1 text-[11px] font-mono text-muted-foreground">{s.sub}</div>
                <div className="mt-3 h-0.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-[image:var(--gradient-uv)] animate-uv-pulse"
                    style={{ width: `${(i + 1) * 16}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-8 text-center">
          <Link
            to="/how-it-works"
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            See the full technical flow <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function AIAssistant() {
  const [input, setInput] = useState("I want to send 100 USDC to Pakistan.");
  const [result, setResult] = useState<null | {
    token: string;
    amount: string;
    country: string;
    currency: string;
    method: string;
  }>({
    token: "USDC",
    amount: "100",
    country: "Pakistan",
    currency: "PKR",
    method: "Bank account",
  });

  function parse() {
    const amountMatch = input.match(/(\d+(?:\.\d+)?)/);
    const tokenMatch = input.match(/\b(USDC|USDT|SOL|JUP|RAY|PYTH|BONK)\b/i);
    const map: Record<string, [string, string]> = {
      pakistan: ["Pakistan", "PKR"],
      nigeria: ["Nigeria", "NGN"],
      philippines: ["Philippines", "PHP"],
      mexico: ["Mexico", "MXN"],
      colombia: ["Colombia", "COP"],
      brazil: ["Brazil", "BRL"],
    };
    const key = Object.keys(map).find((k) => input.toLowerCase().includes(k));
    const [country, currency] = key ? map[key] : ["Pakistan", "PKR"];
    setResult({
      token: (tokenMatch?.[1] ?? "USDC").toUpperCase(),
      amount: amountMatch?.[1] ?? "100",
      country,
      currency,
      method: "Bank account",
    });
  }

  return (
    <section className="mt-32">
      <div className="max-w-5xl mx-auto px-5">
        <SectionHead eyebrow="AI Transfer Assistant" title="Just tell it what you want to send." />
        <div className="mt-8">
          <LammySays size={80} wave>
            {LAMMY_INTRO}
          </LammySays>
        </div>
        <div className="mt-10 rounded-3xl border border-border/60 bg-card overflow-hidden shadow-[var(--shadow-soft)]">
          <div className="p-6 md:p-8 bg-[image:var(--gradient-card)] border-b border-border/60">
            <div className="flex gap-3 items-start">
              <Lammy size={44} className="shrink-0" />
              <div className="flex-1">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={2}
                  className="w-full resize-none bg-transparent outline-none text-lg leading-relaxed"
                />
                <div className="flex justify-end">
                  <button
                    onClick={parse}
                    className="text-sm font-semibold px-4 py-2 rounded-full bg-foreground text-background hover:opacity-90 transition"
                  >
                    Ask assistant
                  </button>
                </div>
              </div>
            </div>
          </div>
          {result && (
            <div className="p-6 md:p-8 grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <LammyCheck label="Lammy understood your request" />
              </div>
              <KV k="Token" v={result.token} />
              <KV k="Amount" v={result.amount} />
              <KV k="Receiver country" v={result.country} />
              <KV k="Receiver currency" v={result.currency} />
              <KV k="Suggested payout method" v={result.method} />
              <KV k="Partner" v="Regulated payout partner (TBD)" />
              <div className="md:col-span-2 text-xs text-muted-foreground flex gap-1.5 items-center pt-2">
                <Info className="w-3.5 h-3.5" /> This is a demo suggestion only.
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl bg-secondary/60 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {k}
      </div>
      <div className="font-semibold mt-0.5">{v}</div>
    </div>
  );
}

function FeeExplainer() {
  const rows = [
    {
      k: "Partner payout fee",
      v: "A small fee (1% of amount, minimum $1) charged by the regulated settlement partner for processing the local-currency payout.",
    },
    {
      k: "LamportPay platform fee",
      v: "A flat 0.5% platform fee that keeps the service running and improving.",
    },
    {
      k: "FX rate",
      v: "The mock FX rate used in this demo to convert USDC into the recipient's local currency.",
    },
    {
      k: "Recipient amount",
      v: "What the recipient will receive after all fees and FX conversion, in their local currency.",
    },
    {
      k: "Quote expiry",
      v: "Real quotes expire after a short window because rates move — demo quotes here are static.",
    },
  ];
  return (
    <section className="mt-32">
      <div className="max-w-5xl mx-auto px-5">
        <SectionHead eyebrow="AI Fee Explainer" title="No surprises. Just plain-English fees." />
        <div className="mt-8">
          <LammySays typing>Let me break down every fee on your transfer, line by line</LammySays>
        </div>
        <div className="mt-10 rounded-3xl border border-border/60 bg-card divide-y divide-border/60">
          {rows.map((r) => (
            <div key={r.k} className="p-6 md:flex md:gap-8 md:items-start">
              <div className="md:w-56 font-semibold">{r.k}</div>
              <div className="text-muted-foreground text-sm md:text-base leading-relaxed mt-1 md:mt-0">
                {r.v}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SafetyAssistant() {
  const items = [
    "Never share your seed phrase.",
    "Crypto payments may be irreversible.",
    "KYC is handled by the licensed partner.",
    "Demo values are not live rates.",
  ];
  return (
    <section className="relative mt-32 overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-grid-uv opacity-25" />
      <div className="max-w-5xl mx-auto px-5">
        <SectionHead eyebrow="Safety Assistant" title="Move money safely — a few reminders." />
        <div className="mt-8">
          <LammySays tone="warning">
            <strong>{LAMMY_SAFETY}</strong> If anyone asks for it — even someone claiming to be
            LamportPay — stop and report it.
          </LammySays>
        </div>
        <div className="mt-10 grid gap-3 md:grid-cols-2">
          {items.map((i) => (
            <div
              key={i}
              className="relative flex items-start gap-3 rounded-2xl p-5 bg-card/80 backdrop-blur border border-border/60 hover:border-[color:var(--warning)]/50 transition overflow-hidden"
            >
              <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[color:var(--warning)] to-[color:var(--neon-magenta)]" />
              <AlertTriangle className="w-5 h-5 text-[color:var(--warning)] shrink-0 mt-0.5" />
              <div className="font-medium">{i}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="mt-32">
      <div className="max-w-6xl mx-auto px-5">
        <div className="rounded-3xl bg-[image:var(--gradient-hero)] text-white p-10 md:p-16 text-center shadow-[var(--shadow-elegant)]">
          <h2 className="text-3xl md:text-5xl font-semibold tracking-tight max-w-2xl mx-auto">
            Try the demo. See a wallet swap and mock payout preview.
          </h2>
          <p className="mt-4 text-white/85 max-w-xl mx-auto">
            Explore the demo flow — mock quote, mock KYC, simulated payout tracking, and receipt
            preview.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Link
              to="/pay"
              className="inline-flex items-center gap-2 rounded-full bg-white text-primary px-6 py-3 font-semibold hover:bg-white/90 transition"
            >
              Send a payment <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/30 text-white px-6 py-3 font-semibold hover:bg-white/20 transition"
            >
              Join waitlist
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center max-w-2xl mx-auto">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</div>
      <h2 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight">{title}</h2>
    </div>
  );
}
