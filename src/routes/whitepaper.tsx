import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/Layout";
import { pageSeo } from "@/lib/seo";
import { FurtherReading } from "@/components/site/blog/FurtherReading";
import { ROADMAP_NOTE, ROADMAP_PHASES } from "@/content/roadmap";

export const Route = createFileRoute("/whitepaper")({
  head: () =>
    pageSeo({
      path: "/whitepaper",
      title: "LamportPay White Paper: Architecture and Roadmap",
      description:
        "Executive summary, settlement architecture, compliance positioning and roadmap for LamportPay's Solana-first payment routing platform.",
    }),
  component: Whitepaper,
});

const sections: { title: string; body: React.ReactNode }[] = [
  {
    title: "1. Executive summary",
    body: (
      <p>
        LamportPay is a Solana-first crypto-to-local-currency payment routing platform. It helps
        users pay with supported crypto assets, settle through USDC, and route local-currency payout
        requests through licensed regulated settlement partners.
      </p>
    ),
  },
  {
    title: "2. Problem",
    body: (
      <p>
        Crypto is global and fast, but recipients usually want local currency in a bank account,
        mobile wallet, card, or cash pickup channel. Existing flows are complex for normal users.
      </p>
    ),
  },
  {
    title: "3. Solution",
    body: (
      <p>
        LamportPay provides a simple transfer interface, AI assistant, USDC settlement model,
        Partner-first payout simulation, and status tracking.
      </p>
    ),
  },
  {
    title: "4. Product positioning",
    body: (
      <p>
        LamportPay is a technology routing platform, not a bank, money transmitter, custodian,
        exchange, or remittance company.
      </p>
    ),
  },
  {
    title: "5. Core flow",
    body: (
      <List
        items={[
          "Sender enters transfer details",
          "LamportPay creates payment",
          "Payout quote generated",
          "Partner KYC",
          "User confirms crypto payment",
          "Jupiter swaps supported token into USDC (later)",
          "USDC settlement verified",
          "Partner processes payout",
          "Recipient receives local currency",
          "LamportPay shows receipt",
        ]}
      />
    ),
  },
  {
    title: "6. Technology architecture",
    body: (
      <div className="space-y-3">
        <ArchRow
          k="Frontend"
          v="Next.js, Tailwind CSS, transfer simulator, AI assistant, receipt dashboard."
        />
        <ArchRow
          k="Backend"
          v="API routes, payment state machine, Payout partner adapter, Jupiter adapter, Solana verifier, webhook handler, database layer."
        />
        <ArchRow
          k="Blockchain"
          v="Solana wallet connection, USDC settlement, Jupiter token-to-USDC swap, Solana transaction verification."
        />
        <ArchRow
          k="Partner"
          v="Payout partner customer/KYC flow, Payout transfer flow, Partner webhook/status updates."
        />
        <ArchRow
          k="Database"
          v="Users, payments, quotes, KYC status, Payout references, Solana transaction signatures, timeline events, receipts."
        />
      </div>
    ),
  },
  {
    title: "7. AI layer",
    body: (
      <p>
        AI transfer assistant, fee explanation, scam warning, payout method guidance, support
        assistant. AI does not approve KYC, perform AML, or make regulated decisions.
      </p>
    ),
  },
  {
    title: "8. Liquidity layer",
    body: <p>Use Jupiter first for Solana token-to-USDC swaps. If user pays in USDC, skip swap.</p>,
  },
  {
    title: "9. Settlement partner layer",
    body: (
      <p>
        Start with a single regulated payout infrastructure partner, then add further partners
        later, Bitso, and Yellow Card.
      </p>
    ),
  },
  {
    title: "10. Supported assets",
    body: (
      <p>
        USDC on Solana for payouts. SOL can be swapped to USDC in the user's own wallet first. More
        tokens are planned.
      </p>
    ),
  },
  {
    title: "11. Supported countries and currencies",
    body: (
      <p>
        Whatever our payout partner supports, checked live with a quote before a payment is created.
        There is no fixed list in LamportPay.
      </p>
    ),
  },
  {
    title: "12. Payment status lifecycle",
    body: (
      <div className="flex flex-wrap gap-2">
        {[
          "CREATED",
          "QUOTE_GENERATED",
          "KYC_PENDING",
          "KYC_APPROVED",
          "PAYMENT_CONFIRMED",
          "JUPITER_SWAP_STARTED",
          "USDC_SETTLED",
          "PAYOUT_SENT_TO_PARTNER",
          "PARTNER_PROCESSING",
          "PAID",
          "FAILED",
          "REFUNDED",
        ].map((s) => (
          <span
            key={s}
            className="text-xs font-mono px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground"
          >
            {s}
          </span>
        ))}
      </div>
    ),
  },
  {
    title: "13. Compliance positioning",
    body: (
      <p>
        LamportPay does not custody user funds, control private keys, issue balances, perform KYC,
        or independently transmit money. Licensed partners handle KYC, KYB, AML, sanctions
        screening, Travel Rule, FX/off-ramp, payout processing, and settlement.
      </p>
    ),
  },
  {
    title: "14. Business model",
    body: (
      <p>
        Small platform fee per completed transfer, SaaS/API fee for businesses, premium dashboard,
        partner referral/commission where legally allowed.
      </p>
    ),
  },
  {
    title: "15. Roadmap",
    body: (
      <div className="space-y-3">
        <List
          items={ROADMAP_PHASES.map(
            (p) =>
              `Phase ${p.phase}: ${p.title}${p.status === "current" ? " (current focus)" : ""}`,
          )}
        />
        <p className="text-sm">{ROADMAP_NOTE}</p>
      </div>
    ),
  },
  {
    title: "16. Risk management",
    body: (
      <div className="space-y-3">
        <div>
          <span className="font-semibold">Risks: </span>regulation, KYC failure, payout delay,
          slippage, wrong wallet, fraud, provider approval.
        </div>
        <div>
          <span className="font-semibold">Mitigations: </span>partner-led KYC before payment, USDC
          settlement, quote expiry, no custody, no user balances, clear refund/failure policy.
        </div>
      </div>
    ),
  },
  {
    title: "17. Conclusion",
    body: (
      <p>
        LamportPay aims to make crypto-to-local-currency transfer simple, explainable, and
        partner-compliant.
      </p>
    ),
  },
];

function Whitepaper() {
  return (
    <SiteLayout>
      <section className="max-w-4xl mx-auto px-5 py-16 md:py-24">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">
          White paper
        </div>
        <h1 className="mt-2 text-4xl md:text-5xl font-semibold tracking-tight">
          LamportPay: crypto-to-local-currency payment routing.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          A Solana-first, USDC-settled, partner-orchestrated payment routing platform.
        </p>

        <div className="mt-14 grid md:grid-cols-[220px_1fr] gap-10">
          <aside className="hidden md:block sticky top-24 self-start">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Contents
            </div>
            <ul className="space-y-1.5 text-sm">
              {sections.map((s) => (
                <li key={s.title}>
                  <a
                    href={`#${slug(s.title)}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
          <div className="space-y-12">
            {sections.map((s) => (
              <section key={s.title} id={slug(s.title)} className="scroll-mt-24">
                <h2 className="text-2xl font-semibold tracking-tight">{s.title}</h2>
                <div className="mt-3 text-muted-foreground leading-relaxed">{s.body}</div>
              </section>
            ))}
          </div>
        </div>
      </section>
      <FurtherReading
        slugs={[
          "why-stablecoins-settle-cross-border-payments",
          "web3-payment-rails-architecture",
          "compliance-roles-in-crypto-payouts",
        ]}
      />
    </SiteLayout>
  );
}

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+$/, "");
}

function List({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2 list-decimal pl-5">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ol>
  );
}

function ArchRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl bg-secondary/60 p-4">
      <div className="font-semibold text-foreground">{k}</div>
      <div className="text-sm mt-1">{v}</div>
    </div>
  );
}
