import type { ReactNode } from "react";
import { ExternalLink, Printer } from "lucide-react";

import { formatMinor } from "@/lib/money";
import type { FeeLine, PaymentView } from "@/lib/payments/view";

/**
 * The payment summary (before the user confirms the transfer) and the receipt
 * (after), with the same rows. The summary shows the full account number the
 * user just typed; a stored receipt only has the masked one, because the full
 * number goes to Stables and is never stored here.
 */
export type ReceiptAccount = {
  holderName: string | null;
  bankName: string | null;
  kind: "iban" | "account_number" | null;
  /** Full in the summary, masked ("••••1234") on a stored receipt. */
  number: string | null;
};

const STATUS_TEXT: Record<string, string> = {
  COMPLETED: "Completed — paid into the bank account",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired before the deposit arrived",
};

function money(minor: string | null, currency: string) {
  return minor === null ? "—" : `${formatMinor(BigInt(minor), currency)} ${currency.toUpperCase()}`;
}

function countryName(code: string) {
  try {
    return `${new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code} (${code})`;
  } catch {
    return code;
  }
}

/** Amount sent for conversion plus LamportPay's fee, in minor units of the source coin. */
function totalMinor(p: PaymentView): string | null {
  if (p.source.amountMinor === null) return null;
  return (BigInt(p.source.amountMinor) + BigInt(p.platformFee?.amountMinor ?? "0")).toString();
}

function feeLabel(kind: string) {
  return kind.replace(/_fee$/, "").replace(/_/g, " ");
}

/** LamportPay's fee is Stables' `integrator_fee`; every other line is Stables'. */
function splitFees(fees: FeeLine[]) {
  return {
    lamportpay: fees.find((f) => f.kind === "integrator_fee") ?? null,
    stables: fees.filter((f) => f.kind !== "integrator_fee" && f.kind !== "total_fee"),
    total: fees.find((f) => f.kind === "total_fee") ?? null,
  };
}

export function PaymentReceipt({
  payment: p,
  mode,
  senderName,
  account,
  footer,
}: {
  payment: PaymentView;
  mode: "summary" | "receipt";
  senderName: string | null;
  account: ReceiptAccount;
  footer?: ReactNode;
}) {
  const fees = splitFees(p.fees);
  const received = mode === "receipt" && p.actualPayout;
  const receipt = mode === "receipt";

  return (
    <div
      className={`rounded-3xl border border-border/60 bg-card space-y-5 print:border-0 print:p-0 ${receipt ? "p-6" : "p-4 sm:p-6"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {receipt ? (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">
              Receipt
            </div>
            <div className="text-lg font-semibold mt-1">
              {money(p.source.amountMinor, p.source.currency)} →{" "}
              {received
                ? money(p.actualPayout!.amountMinor, p.actualPayout!.currency)
                : money(p.destination.amountMinor, p.destination.currency)}
            </div>
          </div>
        ) : (
          <h2 className="text-base font-semibold">Review and pay</h2>
        )}
        {receipt && (
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary print:hidden"
          >
            <Printer className="w-3.5 h-3.5" />
            Print / save as PDF
          </button>
        )}
      </div>

      {receipt ? (
        <>
          <Section title="Payment">
            {receipt && (
              <Row k="Payment ID" v={<span className="font-mono text-xs">{p.id}</span>} />
            )}
            {receipt && (
              <Row
                k="Status"
                v={STATUS_TEXT[p.status] ?? p.status.replace(/_/g, " ").toLowerCase()}
              />
            )}
            {receipt && <Row k="Created" v={new Date(p.createdAt).toLocaleString()} />}
            {receipt && p.completedAt && (
              <Row k="Completed" v={new Date(p.completedAt).toLocaleString()} />
            )}
            <Row k="Sender (verified name)" v={senderName ?? "—"} />
          </Section>

          <Section title="Amounts">
            {/* What leaves the wallet = amount converted + LamportPay's fee (owner model:
            the fee comes out of what the user sends). */}
            <Row
              k="Total from your wallet"
              v={<strong>{money(totalMinor(p), p.source.currency)}</strong>}
            />
            <Row
              k="LamportPay service fee"
              v={
                p.platformFee
                  ? money(p.platformFee.amountMinor, p.platformFee.currency)
                  : fees.lamportpay
                    ? money(fees.lamportpay.amountMinor, fees.lamportpay.currency)
                    : "None"
              }
            />
            <Row
              k={`Sent for conversion (${p.source.currency.toUpperCase()} on Solana)`}
              v={money(p.source.amountMinor, p.source.currency)}
            />
            {fees.stables
              .filter((f) => BigInt(f.amountMinor) !== 0n)
              .map((f) => (
                <Row
                  key={f.kind}
                  k={`Payout partner: ${feeLabel(f.kind)} fee`}
                  v={money(f.amountMinor, f.currency)}
                />
              ))}
            {fees.total && (
              <Row
                k="Payout partner fees (total)"
                v={money(fees.total.amountMinor, fees.total.currency)}
              />
            )}
            <Row
              k="Exchange rate (after partner fees)"
              v={
                p.exchangeRate === null
                  ? "—"
                  : `1 ${p.source.currency.toUpperCase()} = ${Number(Number(p.exchangeRate).toPrecision(6))} ${p.destination.currency.toUpperCase()}`
              }
            />
            <Row
              k={received ? "Bank account received" : "Bank account receives (quoted)"}
              v={
                <strong>
                  {received
                    ? money(p.actualPayout!.amountMinor, p.actualPayout!.currency)
                    : money(p.destination.amountMinor, p.destination.currency)}
                </strong>
              }
            />
            <Row
              k="Payout currency"
              v={(received ? p.actualPayout!.currency : p.destination.currency).toUpperCase()}
            />
          </Section>

          <Section title="Payout bank account">
            <Row k="Account holder" v={account.holderName ?? "—"} />
            <Row
              k={account.kind === "iban" ? "IBAN" : "Account number"}
              v={<span className="font-mono">{account.number ?? "—"}</span>}
            />
            <Row k="Bank name" v={account.bankName ?? "—"} />
            <Row k="Country" v={countryName(p.destination.country)} />
          </Section>
        </>
      ) : (
        // Review before paying: the essentials only (the receipt keeps every line).
        // Amounts beside the bank account on wide screens, so it fits without scrolling.
        <div className="space-y-5 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-x-8">
          <Section title="Amounts">
            <Row k="You send" v={<strong>{money(totalMinor(p), p.source.currency)}</strong>} />
            <Row
              k="LamportPay fee"
              v={
                p.platformFee
                  ? money(p.platformFee.amountMinor, p.platformFee.currency)
                  : fees.lamportpay
                    ? money(fees.lamportpay.amountMinor, fees.lamportpay.currency)
                    : "None"
              }
            />
            {fees.total ? (
              <Row k="Payout partner fee" v={money(fees.total.amountMinor, fees.total.currency)} />
            ) : (
              fees.stables
                .filter((f) => BigInt(f.amountMinor) !== 0n)
                .map((f) => (
                  <Row
                    key={f.kind}
                    k={`Partner ${feeLabel(f.kind)} fee`}
                    v={money(f.amountMinor, f.currency)}
                  />
                ))
            )}
            <Row k="Amount converted" v={money(p.source.amountMinor, p.source.currency)} />
            <Row
              k="Rate"
              v={
                p.exchangeRate === null
                  ? "—"
                  : `1 ${p.source.currency.toUpperCase()} = ${Number(Number(p.exchangeRate).toPrecision(6))} ${p.destination.currency.toUpperCase()}`
              }
            />
            <Row
              k="You receive"
              v={
                <strong className="text-base text-uv">
                  {money(p.destination.amountMinor, p.destination.currency)}
                </strong>
              }
            />
          </Section>
          <Section title="To your bank account">
            <Row k="Account holder" v={account.holderName ?? senderName ?? "—"} />
            <Row k="Bank" v={account.bankName ?? "—"} />
            <Row
              k={account.kind === "iban" ? "IBAN" : "Account number"}
              v={<span className="font-mono">{account.number ?? "—"}</span>}
            />
            <Row k="Country" v={countryName(p.destination.country)} />
          </Section>
        </div>
      )}
      {receipt && (
        <Section title="References">
          <Row
            k="Stables transfer ID"
            v={<span className="font-mono text-xs">{p.transferId ?? "—"}</span>}
          />
          <Row
            k="Solana transaction"
            v={
              p.funding ? (
                <a
                  href={`https://explorer.solana.com/tx/${p.funding.signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline break-all"
                >
                  {p.funding.signature.slice(0, 16)}…
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              ) : p.simulatedDeposit ? (
                "Simulated deposit (Stables sandbox)"
              ) : (
                "—"
              )
            }
          />
        </Section>
      )}

      {footer}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {title}
      </h3>
      <dl className="divide-y divide-border/50">{children}</dl>
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{k}</dt>
      {/* Amounts never split mid-number; long IDs may still wrap anywhere. */}
      <dd className="text-right [overflow-wrap:anywhere] [&:not(:has(.font-mono))]:whitespace-nowrap">
        {v}
      </dd>
    </div>
  );
}
