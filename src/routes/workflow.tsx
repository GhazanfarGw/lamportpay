import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Route as RouteIcon, Landmark, ShieldCheck } from "lucide-react";

import { SiteLayout } from "@/components/site/Layout";
import { SwapRoutePreviewCard } from "@/components/site/SwapRoutePreview";
import { pageSeo } from "@/lib/seo";
import { FurtherReading } from "@/components/site/blog/FurtherReading";

export const Route = createFileRoute("/workflow")({
  head: () =>
    pageSeo({
      path: "/workflow",
      title: "Workflow and Integration Status | LamportPay",
      description:
        "How swaps and bank payouts map to each stage of a LamportPay payment, and which partner handles each step.",
    }),
  component: WorkflowPage,
});

const STAGES = [
  {
    stage: "1. Transfer details",
    demo: "You enter the amount, country and payout currency in the app; the payout partner checks support with a live quote.",
    provider: "None",
    real: "Same form, but corridor availability would be validated against a regulated payout partner's supported rails.",
  },
  {
    stage: "2. Swap routing",
    demo: "Only when your wallet lacks USDC: you sign a swap in your own wallet and the output stays there.",
    provider: "Jupiter",
    real: "Jupiter /swap/v2/order returns the transaction; you sign it in your own wallet.",
  },
  {
    stage: "3. Settlement check",
    demo: "The server checks the finalized Solana transaction: exact amount, sender and deposit address.",
    provider: "Solana RPC",
    real: "An RPC confirmation step verifies the USDC balance change before payout is requested.",
  },
  {
    stage: "4. Identity check",
    demo: "On the payout partner's hosted page. LamportPay stores no identity documents.",
    provider: "Regulated payout partner (disabled)",
    real: "Partner-hosted KYC/KYB runs on the licensed partner side, never inside LamportPay.",
  },
  {
    stage: "5. Payout request",
    demo: "Paid to a bank account in your own name, in local currency.",
    provider: "Regulated payout partner",
    real: "Payout transfer endpoint moves USDC to the recipient's bank rail in local currency.",
  },
  {
    stage: "6. Tracking and receipt",
    demo: "Signed partner webhooks and reconciliation update your status timeline and receipt.",
    provider: "Partner webhooks",
    real: "Signed Partner webhooks update the transfer status in real time.",
  },
];

function WorkflowPage() {
  return (
    <SiteLayout>
      <div className="max-w-5xl mx-auto px-5 py-14 md:py-20">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">
          Integration workflow
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mt-2">
          How a LamportPay payment works
        </h1>
        <p className="text-muted-foreground mt-3 max-w-2xl">
          LamportPay splits the flow into a swap layer and a payout layer. A swap, only when needed,
          turns SOL into USDC in your own wallet. A licensed payout partner turns USDC into local
          currency and pays it into your own bank account. You sign every on-chain step yourself.
        </p>

        <div className="grid md:grid-cols-3 gap-4 mt-8">
          {[
            {
              icon: RouteIcon,
              title: "Swap layer",
              body: "Route discovery, expected USDC output, slippage and fees. Output always returns to your own wallet.",
            },
            {
              icon: Landmark,
              title: "Payout layer — regulated partner",
              body: "Identity verification, currency conversion and bank payout, reported back to LamportPay with signed webhooks.",
            },
            {
              icon: ShieldCheck,
              title: "Guards",
              body: "0.001–0.01 SOL limits, destination verification, no fiat payout, no KYC, no key material accepted.",
            },
          ].map((c) => (
            <div key={c.title} className="rounded-2xl border border-border/60 bg-card p-5">
              <c.icon className="w-5 h-5 text-primary" />
              <div className="font-semibold text-sm mt-3">{c.title}</div>
              <p className="text-xs text-muted-foreground mt-1.5">{c.body}</p>
            </div>
          ))}
        </div>

        <h2 className="text-xl font-semibold mt-12">Step-by-step mapping</h2>
        <div className="mt-4 rounded-3xl border border-border/60 overflow-hidden bg-card">
          {STAGES.map((s) => (
            <div key={s.stage} className="border-b border-border/40 last:border-0 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <div className="font-semibold text-sm">{s.stage}</div>
                <span className="inline-flex items-center rounded-full border border-border/60 bg-secondary px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {s.provider}
                </span>
              </div>
              <div className="grid md:grid-cols-2 gap-3 mt-3 text-xs">
                <div className="rounded-xl border border-border/60 bg-background p-3">
                  <div className="font-semibold mb-1">How it works today</div>
                  <p className="text-muted-foreground">{s.demo}</p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background p-3">
                  <div className="font-semibold mb-1">In a real integration</div>
                  <p className="text-muted-foreground">{s.real}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <h2 className="text-xl font-semibold mt-12">Swap route preview</h2>
        <p className="text-sm text-muted-foreground mt-2">
          A live, read-only preview of a SOL → USDC swap route: expected USDC output and fees.
          Nothing is signed here.
        </p>
        <div className="mt-4">
          <SwapRoutePreviewCard />
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/swap"
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold"
          >
            Swap SOL to USDC <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to="/pay"
            className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-semibold hover:bg-secondary transition"
          >
            Convert
          </Link>
        </div>
      </div>
      <FurtherReading
        slugs={[
          "web3-payment-rails-architecture",
          "solana-payments-for-developers",
          "crypto-to-fiat-payments-explained",
        ]}
      />
    </SiteLayout>
  );
}
