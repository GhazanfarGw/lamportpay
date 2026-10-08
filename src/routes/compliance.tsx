import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/Layout";
import { ShieldCheck, XCircle, CheckCircle2, FlaskConical } from "lucide-react";
import { pageSeo } from "@/lib/seo";
import { FurtherReading } from "@/components/site/blog/FurtherReading";

export const Route = createFileRoute("/compliance")({
  head: () =>
    pageSeo({
      path: "/compliance",
      title: "Compliance Position | LamportPay",
      description:
        "LamportPay is non-custodial software. It holds no funds or keys. Identity verification, screening, currency conversion and bank payouts are carried out by a licensed payout partner, to the customer's own bank account only.",
    }),
  component: Compliance,
});

const LAST_UPDATED = "7 October 2026";

function Compliance() {
  const negatives = [
    "Hold customer funds, private keys or balances. Our ledger is a record only.",
    "Collect identity documents. Verification happens on the payout partner's hosted page.",
    "Convert currency or send bank payouts itself.",
    "Pay out to third parties, mobile wallets, cards or cash.",
    "Ask for a seed phrase or private key. Wallet sign-in is a message signature, never a transaction.",
    "Claim a licence or regulatory approval of its own.",
  ];
  const positives = [
    "Provides the software: quote, checkout, wallet signing request and payment tracking.",
    "Shows every cost before you sign: one LamportPay fee, the partner's fee and network fees as separate lines.",
    "Pays out only to the verified customer's own bank account. The account holder name comes from the verified record and cannot be edited.",
    "Follows the payout partner's transfer status. The partner's record is authoritative.",
    "Keeps an append-only audit log of admin actions.",
    "Supports USDC on Solana only, for now.",
  ];
  const roles: { activity: string; who: string }[] = [
    {
      activity: "Holding funds",
      who: "No one at LamportPay. You send USDC from your own wallet straight to a single-use deposit address that the payout partner issues for that transfer.",
    },
    {
      activity: "Identity verification (KYC)",
      who: "Payout partner, on its hosted page. LamportPay stores only the verification status.",
    },
    { activity: "AML and sanctions screening", who: "Payout partner." },
    {
      activity: "Travel Rule",
      who: "Payout partner. LamportPay records whether a payment needs Travel Rule information.",
    },
    {
      activity: "Bank details check, currency conversion and payout",
      who: "Payout partner.",
    },
    {
      activity: "Quote, fee disclosure, checkout and status tracking",
      who: "LamportPay.",
    },
    { activity: "Approving the transaction", who: "You, in your own wallet." },
  ];
  return (
    <SiteLayout>
      <section className="max-w-4xl mx-auto px-5 py-16 md:py-24">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">
          Compliance
        </div>
        <h1 className="mt-2 text-4xl md:text-5xl font-semibold tracking-tight">
          Non-custodial software. Regulated activity sits with a licensed partner.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          This page is maintained by the LamportPay team to answer common security and compliance
          questions. It is not a certification or legal advice.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Last updated {LAST_UPDATED}.</p>

        <div className="mt-10 rounded-2xl border border-border/60 bg-card p-6 flex items-start gap-4">
          <FlaskConical className="w-6 h-6 text-primary shrink-0 mt-1" />
          <div>
            <div className="font-semibold">Current status: controlled test phase</div>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              The app runs in test mode: Solana devnet, the payout partner's sandbox and test
              tokens. No real funds move. Real-money payouts start only after the partner's
              production approval of LamportPay (including KYB), legal review and approval of each
              payout country.
            </p>
          </div>
        </div>

        <div className="mt-6 grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-border/60 bg-card p-6">
            <div className="flex items-center gap-2 font-semibold mb-4">
              <XCircle className="w-5 h-5 text-destructive" /> What LamportPay does not do
            </div>
            <ul className="space-y-3 text-sm">
              {negatives.map((n) => (
                <li key={n} className="text-muted-foreground">
                  {n}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-6">
            <div className="flex items-center gap-2 font-semibold mb-4">
              <CheckCircle2 className="w-5 h-5 text-[color:var(--success)]" /> What LamportPay does
            </div>
            <ul className="space-y-3 text-sm">
              {positives.map((n) => (
                <li key={n} className="text-muted-foreground">
                  {n}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 rounded-2xl border border-border/60 bg-card p-6">
          <div className="font-semibold">Who does what</div>
          <dl className="mt-4 divide-y divide-border/60 text-sm">
            {roles.map((r) => (
              <div key={r.activity} className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
                <dt className="font-medium">{r.activity}</dt>
                <dd className="text-muted-foreground">{r.who}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-10 rounded-2xl bg-[image:var(--gradient-card)] border border-border/60 p-6 flex items-start gap-4">
          <ShieldCheck className="w-6 h-6 text-primary shrink-0 mt-1" />
          <div>
            <div className="font-semibold">Partner-led compliance</div>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              KYC, AML, sanctions screening, Travel Rule, currency conversion, payout processing and
              settlement are performed by a licensed payout partner, not by LamportPay. This posture
              is intentional: it keeps the platform's surface area narrow and defensible. The
              partner may refuse or hold a payment under its own rules.
            </p>
          </div>
        </div>

        <div className="mt-10 rounded-2xl border border-border/60 bg-card p-6">
          <div className="font-semibold">Company information</div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Legal entity
              </dt>
              <dd className="mt-1 font-medium">Lamport Pay Ltd</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Product / platform
              </dt>
              <dd className="mt-1 font-medium">LamportPay</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Business email
              </dt>
              <dd className="mt-1">
                <a href="mailto:hello@lamportpay.com" className="font-medium hover:underline">
                  hello@lamportpay.com
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Registration number
              </dt>
              <dd className="mt-1 text-muted-foreground">To be provided</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Registered address
              </dt>
              <dd className="mt-1 text-muted-foreground">To be provided</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Licenses / regulatory approvals
              </dt>
              <dd className="mt-1 text-muted-foreground">
                None claimed. Regulated activity is performed by the licensed payout partner.
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-10 text-xs text-muted-foreground">
          LamportPay does not hold customer funds or keys. Identity verification, currency
          conversion and bank payouts are provided by a licensed payout partner, to the customer's
          own bank account only. LamportPay is in a controlled test phase.
        </div>
      </section>
      <FurtherReading
        slugs={[
          "compliance-roles-in-crypto-payouts",
          "crypto-to-fiat-payments-explained",
          "designing-transparent-payment-quotes",
        ]}
      />
    </SiteLayout>
  );
}
