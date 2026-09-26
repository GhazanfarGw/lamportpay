import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/Layout";
import { pageSeo } from "@/lib/seo";
import { FurtherReading } from "@/components/site/blog/FurtherReading";

export const Route = createFileRoute("/docs")({
  head: () =>
    pageSeo({
      path: "/docs",
      title: "Developer Docs: Stack and API Surface | LamportPay",
      description:
        "Architecture overview, technology stack and the API surface behind the LamportPay demo, including Jupiter swap and Solana verification endpoints.",
    }),
  component: Docs,
});

const stack = [
  { k: "Frontend", v: "Next.js + Tailwind CSS" },
  { k: "Backend", v: "API routes and payment state machine" },
  { k: "Liquidity", v: "Jupiter (planned)" },
  { k: "Settlement", v: "Regulated payout partner (planned)" },
  { k: "Blockchain", v: "Solana + USDC" },
  { k: "Database", v: "Supabase / PostgreSQL (planned)" },
];

const apis = [
  "POST /api/payments",
  "POST /api/payout-quote",
  "POST /api/payout-kyc/start",
  "POST /api/payout-kyc/complete",
  "POST /api/payments/confirm",
  "POST /api/jupiter/quote",
  "POST /api/jupiter/order",
  "POST /api/jupiter/execute",
  "POST /api/solana/verify-transaction",
  "POST /api/payout-transfer",
  "GET /api/payments/[paymentId]",
  "GET /api/receipt/[paymentId]",
  "POST /api/payout/quote",
  "POST /api/payout/customer",
  "POST /api/payout/external-account",
  "POST /api/payout/transfer",
  "POST /api/public/payout-webhook",
];

function Docs() {
  return (
    <SiteLayout>
      <section className="max-w-5xl mx-auto px-5 py-16 md:py-24">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">
          Developer docs
        </div>
        <h1 className="mt-2 text-4xl md:text-5xl font-semibold tracking-tight">
          Build against a partner-led payment routing layer.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
          The demo ships with a clear architecture and a planned API surface. Real integrations plug
          in behind these endpoints.
        </p>

        <div className="mt-14">
          <h2 className="text-2xl font-semibold tracking-tight">Stack</h2>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {stack.map((s) => (
              <div key={s.k} className="rounded-2xl border border-border/60 bg-card p-5">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {s.k}
                </div>
                <div className="font-semibold mt-1">{s.v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight">API flow</h2>
          <div className="mt-6 rounded-2xl border border-border/60 bg-card overflow-hidden">
            <pre className="p-6 text-sm font-mono leading-7 overflow-x-auto whitespace-pre">
              {apis.join("\n")}
            </pre>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            All endpoints are conceptual until backend MVP. The demo UI is designed so real
            implementations can slot in without changing user-visible flows.
          </p>
        </div>
      </section>
      <FurtherReading slugs={["solana-payments-for-developers", "web3-payment-rails-architecture", "why-stablecoins-settle-cross-border-payments"]} />
    </SiteLayout>
  );
}
