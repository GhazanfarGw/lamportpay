import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/Layout";
import { ShieldCheck, XCircle, CheckCircle2 } from "lucide-react";
import { pageSeo } from "@/lib/seo";
import { FurtherReading } from "@/components/site/blog/FurtherReading";

export const Route = createFileRoute("/compliance")({
  head: () =>
    pageSeo({
      path: "/compliance",
      title: "Compliance Position | LamportPay",
      description:
        "LamportPay is a technology platform. It does not custody funds, perform real KYC, convert to fiat, or transmit money. Licensed partners would handle regulated payout.",
    }),
  component: Compliance,
});

function Compliance() {
  const negatives = [
    "LamportPay does not custody funds.",
    "LamportPay does not perform real KYC.",
    "LamportPay does not independently transmit money.",
  ];
  const positives = [
    "LamportPay is a technology platform.",
    "Licensed partners handle regulated payout activity.",
    "LamportPay is evaluating regulated infrastructure partners for future fiat conversion and payout services. No agreement is in place.",
    "Real launch requires partner approval, KYB, legal review, and corridor approval.",
  ];
  return (
    <SiteLayout>
      <section className="max-w-4xl mx-auto px-5 py-16 md:py-24">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">
          Compliance
        </div>
        <h1 className="mt-2 text-4xl md:text-5xl font-semibold tracking-tight">
          A technology platform. Not a money transmitter.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          This page is maintained by the LamportPay team to answer common security and compliance
          questions about the demo. It is not a certification.
        </p>

        <div className="mt-12 grid md:grid-cols-2 gap-4">
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

        <div className="mt-10 rounded-2xl bg-[image:var(--gradient-card)] border border-border/60 p-6 flex items-start gap-4">
          <ShieldCheck className="w-6 h-6 text-primary shrink-0 mt-1" />
          <div>
            <div className="font-semibold">Partner-led compliance</div>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              KYC, KYB, AML, sanctions screening, Travel Rule, FX/off-ramp, payout processing, and
              settlement are performed by licensed regulated settlement partners — not by LamportPay. This
              posture is intentional: it keeps the surface area of the platform narrow and
              defensible.
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
                None claimed. Regulated activity is performed by licensed partners.
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-10 text-xs text-muted-foreground">
          Demo only. /swap may execute a small real Jupiter SOL-to-USDC swap back to the connected
          wallet. LamportPay does not process fiat payout, KYC, FX conversion, bank payout, or
          third-party recipient transfer. No partnership, agreement, or integration with any
          payout provider is in place or claimed.
        </div>

      </section>
      <FurtherReading slugs={["compliance-roles-in-crypto-payouts", "crypto-to-fiat-payments-explained", "designing-transparent-payment-quotes"]} />
    </SiteLayout>
  );
}
