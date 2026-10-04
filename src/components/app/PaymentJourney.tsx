/**
 * The conversion journey on /pay: where the user is (stepper), what it costs
 * (one cost summary, including a swap when one happened), and what actually
 * happened (status timeline). Everything here is derived from the payment the
 * server returned — backend, Stables and on-chain data only. Nothing is shown
 * as done because the browser assumes it.
 */
import {
  BadgeCheck,
  Check,
  CircleDashed,
  ClipboardCheck,
  Coins,
  ExternalLink,
  Loader2,
  PenLine,
  Receipt,
  RefreshCw,
  Wallet,
  X,
} from "lucide-react";
import type { ReactNode } from "react";

import { formatMinor } from "@/lib/money";
import type { PaymentView } from "@/lib/payments/view";

const TRANSFER_ORDER = [
  "CREATED",
  "AWAITING_FUNDS_COLLECTION",
  "FUNDS_COLLECTED",
  "IN_PROGRESS",
  "PAYMENT_SUBMITTED",
  "PAYMENT_PROCESSED",
  "COMPLETED",
] as const;
const FAILED = new Set(["FAILED", "CANCELLED", "EXPIRED", "KYC_REJECTED"]);

function rank(status: string): number {
  return TRANSFER_ORDER.indexOf(status as (typeof TRANSFER_ORDER)[number]);
}

function explorer(signature: string) {
  return `https://explorer.solana.com/tx/${signature}`;
}

function money(minor: string | null, currency: string) {
  return minor === null ? "—" : `${formatMinor(BigInt(minor), currency)} ${currency.toUpperCase()}`;
}

function TxLink({
  signature,
  label = "View on Solana",
  href,
}: {
  signature: string;
  label?: string;
  /** An explorer URL on another network (TEST MODE: devnet). */
  href?: string;
}) {
  return (
    <a
      href={href ?? explorer(signature)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
    >
      {label} <ExternalLink className="w-3 h-3" />
    </a>
  );
}

// ------------------------------------------------------------------ stepper

/** The seven steps of the conversion, as the user sees them. */
export const DAPP_STEPS = [
  "Connect",
  "Select",
  "Quote",
  "Review",
  "Sign",
  "Processing",
  "Complete",
] as const;

const PROCESSING = new Set([
  "FUNDS_COLLECTED",
  "COMPLIANCE_HOLD",
  "IN_PROGRESS",
  "PAYMENT_SUBMITTED",
  "PAYMENT_PROCESSED",
]);

/**
 * Where a payment sits in the seven steps, from its real (server) status only.
 * Identity verification is part of "Quote": Stables quotes only verified users.
 */
export function dappStepFor(p: PaymentView): number {
  if (p.status === "COMPLETED") return DAPP_STEPS.length;
  // A detected payment (LIVE funding, or the TEST MODE devnet transaction) is
  // past "Sign" even while Stables still reports the transfer as waiting.
  if (PROCESSING.has(p.status) || p.funding || p.testPayment) return 5;
  if (p.status === "CREATED" || p.status === "AWAITING_FUNDS_COLLECTION") return 4;
  if (p.status === "QUOTED") return 3;
  if (p.transferId) return 5;
  return 2;
}

const STEP_META: Record<(typeof DAPP_STEPS)[number], { hint: string; icon: typeof Check }> = {
  Connect: { hint: "Link your Solana wallet", icon: Wallet },
  Select: { hint: "Amount and destination", icon: Coins },
  Quote: { hint: "Live rate and costs", icon: Receipt },
  Review: { hint: "Your bank details", icon: ClipboardCheck },
  Sign: { hint: "Approve in your wallet", icon: PenLine },
  Processing: { hint: "Conversion and payout", icon: RefreshCw },
  Complete: { hint: "Paid to your bank", icon: BadgeCheck },
};

type RailState = "done" | "current" | "pending" | "failed";

function stepState(i: number, current: number, failed: boolean): RailState {
  return i < current ? "done" : i === current ? (failed ? "failed" : "current") : "pending";
}

/**
 * The conversion journey. Desktop: a vertical rail (icons, connecting lines,
 * one-line hints). Mobile: a compact bar with the current step's name, so it
 * never takes the screen. Derived only from real state passed in.
 */
export function DappStepper({ current, failed = false }: { current: number; failed?: boolean }) {
  const label = DAPP_STEPS[Math.min(current, DAPP_STEPS.length - 1)]!;
  const done = current >= DAPP_STEPS.length;
  return (
    <nav aria-label="Conversion progress">
      {/* Desktop rail */}
      <ol className="hidden lg:block">
        {DAPP_STEPS.map((name, i) => {
          const state = stepState(i, current, failed);
          const { icon: Icon, hint } = STEP_META[name];
          const last = i === DAPP_STEPS.length - 1;
          return (
            <li
              key={name}
              className="relative flex gap-3 pb-6 last:pb-0"
              aria-current={state === "current" ? "step" : undefined}
            >
              {!last && (
                <span
                  aria-hidden
                  className={`absolute left-[17px] top-9 bottom-0 w-0.5 rounded-full transition-colors duration-500 ${
                    i < current ? "bg-[image:var(--gradient-hero)]" : "bg-border"
                  }`}
                />
              )}
              <span
                className={`relative z-10 grid place-items-center shrink-0 w-9 h-9 rounded-xl border transition-all duration-300 ${
                  state === "done"
                    ? "bg-[image:var(--gradient-hero)] text-white border-transparent shadow-[var(--shadow-soft)]"
                    : state === "current"
                      ? "bg-card text-primary border-primary/60 ring-4 ring-primary/15 shadow-[0_0_24px_-6px_var(--primary-glow)]"
                      : state === "failed"
                        ? "bg-destructive text-destructive-foreground border-destructive"
                        : "bg-card/70 text-muted-foreground border-border"
                }`}
              >
                {state === "done" ? (
                  <Check className="w-4 h-4" />
                ) : state === "failed" ? (
                  <X className="w-4 h-4" />
                ) : (
                  <Icon
                    className={`w-4 h-4 ${state === "current" && name === "Processing" ? "animate-spin [animation-duration:2.5s]" : ""}`}
                  />
                )}
              </span>
              <span className="pt-1 min-w-0">
                <span
                  className={`block text-sm leading-tight ${
                    state === "pending"
                      ? "text-muted-foreground"
                      : state === "current"
                        ? "font-semibold text-foreground"
                        : "font-medium text-foreground"
                  }`}
                >
                  {name}
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  {state === "current"
                    ? failed
                      ? "Stopped here"
                      : hint
                    : state === "done"
                      ? "Done"
                      : hint}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {/* Mobile / tablet: compact bar */}
      <div className="lg:hidden rounded-2xl border border-border/60 bg-card/80 backdrop-blur px-4 py-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {done ? "All steps complete" : `Step ${current + 1} of ${DAPP_STEPS.length}`}
          </span>
          <span className={`font-semibold ${failed ? "text-destructive" : "text-primary"}`}>
            {done ? "Complete" : label}
          </span>
        </div>
        <ol className="flex gap-1">
          {DAPP_STEPS.map((name, i) => {
            const state = stepState(i, current, failed);
            return (
              <li
                key={name}
                aria-label={name}
                aria-current={state === "current" ? "step" : undefined}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  state === "done"
                    ? "bg-[image:var(--gradient-hero)]"
                    : state === "current"
                      ? "bg-primary/60 animate-pulse"
                      : state === "failed"
                        ? "bg-destructive"
                        : "bg-border"
                }`}
              />
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

/** The stepper for an existing payment. */
export function JourneyStepper({ payment }: { payment: PaymentView }) {
  return <DappStepper current={dappStepFor(payment)} failed={FAILED.has(payment.status)} />;
}

// ------------------------------------------------------------- cost summary

function Line({
  label,
  value,
  hint,
  strong = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <div className={strong ? "font-semibold" : "text-sm text-muted-foreground"}>{label}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <div className={`text-right tabular-nums ${strong ? "font-semibold" : "text-sm"}`}>
        {value}
      </div>
    </div>
  );
}

/** "NG" → "Nigeria"; falls back to the code if the runtime has no name for it. */
function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/**
 * One quote summary, from real data only: what the user sends, LamportPay's
 * service fee (out of that), the payout partner's quoted fee, the amount
 * converted, the rate and what reaches the bank. Partner fee parts and any
 * swap sit under an expandable "Fee details". Nothing is estimated.
 */
export function CostSummary({ payment: p }: { payment: PaymentView }) {
  const swap = p.latestSwap && p.latestSwap.status === "landed" ? p.latestSwap : null;
  const receives = p.actualPayout
    ? {
        label: "You received",
        minor: p.actualPayout.amountMinor,
        currency: p.actualPayout.currency,
      }
    : {
        label: p.quote || p.transferId ? "You receive" : "You receive (estimate)",
        minor: p.destination.amountMinor,
        currency: p.destination.currency,
      };
  // The partner's total is the headline; its non-zero parts are the details.
  const partnerTotal = p.fees.find((f) => f.kind === "total_fee") ?? null;
  const partnerParts = p.fees.filter(
    (f) => f.kind !== "total_fee" && f.kind !== "integrator_fee" && BigInt(f.amountMinor) !== 0n,
  );
  const lamportpayLabel =
    p.platformFee?.rule === "minimum"
      ? "LamportPay service fee (minimum)"
      : p.platformFee?.rule === "maximum"
        ? "LamportPay service fee (maximum)"
        : "LamportPay service fee";
  const rate =
    p.exchangeRate !== null ? Number(Number(p.exchangeRate).toPrecision(6)).toString() : null;

  return (
    <div className="rounded-2xl border border-border/60 bg-background overflow-hidden">
      <div className="px-5 py-3 flex items-center justify-between gap-4">
        <span className="text-sm text-muted-foreground">You send</span>
        <span className="font-semibold tabular-nums">
          {money(p.totalToPay.amountMinor, p.totalToPay.currency)}
        </span>
      </div>

      <div className="px-5 py-2 border-t border-border/50">
        <Line
          label={lamportpayLabel}
          value={p.platformFee ? money(p.platformFee.amountMinor, p.platformFee.currency) : "None"}
          hint="Comes out of what you send"
        />
        <Line
          label="Payout partner fee"
          value={
            partnerTotal ? (
              money(partnerTotal.amountMinor, partnerTotal.currency)
            ) : (
              <span className="text-muted-foreground">live quote</span>
            )
          }
          hint="Deducted inside the payout (included in the rate)"
        />
        <Line label="Amount converted" value={money(p.source.amountMinor, p.source.currency)} />
        {rate && (
          <Line
            label="Exchange rate (after partner fees)"
            value={`1 ${p.source.currency.toUpperCase()} = ${rate} ${p.destination.currency.toUpperCase()}`}
          />
        )}
        <p className="text-[11px] text-muted-foreground pb-1">
          Solana network fee: a tiny amount of SOL, shown in your wallet when you approve.
        </p>
      </div>

      <details className="group px-5 py-2 border-t border-border/50">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Fee details
        </summary>
        {partnerParts.map((f) => (
          <Line
            key={f.kind}
            label={`Partner ${f.kind.replace(/_fee$/, "").replace(/_/g, " ")} fee`}
            value={money(f.amountMinor, f.currency)}
          />
        ))}
        {partnerParts.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">No other partner fees on this quote.</p>
        )}
        {swap && (
          <Line
            label="Swap in your wallet"
            value={`${swap.inAmount} ${swap.inputAsset.toUpperCase()} → ${swap.actualOut ?? swap.minOut} ${swap.outputAsset.toUpperCase()}`}
            hint={
              <>
                Swap price and network fee as executed on Solana
                {swap.signature && (
                  <>
                    {" · "}
                    <TxLink signature={swap.signature} />
                  </>
                )}
              </>
            }
          />
        )}
      </details>

      <div className="px-5 py-4 border-t border-dashed border-border/80 bg-[linear-gradient(135deg,oklch(0.62_0.28_295/0.08),oklch(0.82_0.18_200/0.08))]">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {receives.label}
        </div>
        <div className="text-3xl font-semibold tracking-tight mt-1 tabular-nums text-uv">
          {money(receives.minor, receives.currency)}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {p.destination.currency.toUpperCase()} · into your own bank account in{" "}
          {regionName(p.destination.country)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------- status timeline

type StepState = "done" | "current" | "pending" | "failed" | "skipped";
type TimelineStep = {
  key: string;
  label: string;
  state: StepState;
  detail?: ReactNode;
  at?: string | null;
};

function transitionAt(p: PaymentView, to: string): string | null {
  return p.events.find((e) => e.to === to)?.at ?? null;
}

function stepFromRank(p: PaymentView, reached: number, doneAfter: number): StepState {
  const failed = FAILED.has(p.status);
  // A failed payment keeps the steps it really reached (from its recorded transitions).
  const r = failed ? Math.max(-1, ...p.events.map((e) => rank(e.to ?? ""))) : rank(p.status);
  if (r >= doneAfter) return "done";
  if (r >= reached) return failed ? "failed" : "current";
  return failed ? "skipped" : "pending";
}

/** What has really happened to this payment, step by step. */
function statusSteps(p: PaymentView): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const wallet = p.payerWallet ?? p.settlement?.wallet ?? null;
  steps.push({
    key: "quote",
    label: "Quote",
    state: p.quote || p.transferId ? "done" : p.status === "KYC_APPROVED" ? "current" : "pending",
    detail: p.quote ? `Quote ${p.quote.id}` : undefined,
    at: transitionAt(p, "QUOTED"),
  });
  steps.push({
    key: "wallet",
    label: "Wallet connected",
    state: wallet ? "done" : "pending",
    detail: wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : undefined,
  });
  if (p.latestSwap) {
    const s = p.latestSwap;
    steps.push({
      key: "swap",
      label: "Swap in your wallet",
      state:
        s.status === "landed"
          ? "done"
          : ["failed", "expired", "abandoned"].includes(s.status)
            ? "failed"
            : "current",
      detail: s.signature ? <TxLink signature={s.signature} /> : (s.failureReason ?? undefined),
      at: s.createdAt,
    });
  }
  const fundable = p.status === "CREATED" || p.status === "AWAITING_FUNDS_COLLECTION";
  steps.push({
    key: "signed",
    label: "Transaction signed and sent",
    state:
      p.funding || p.testPayment || p.simulatedDeposit
        ? "done"
        : fundable && p.deposit
          ? "current"
          : "pending",
    detail: p.funding ? (
      <TxLink signature={p.funding.signature} />
    ) : p.testPayment ? (
      <TxLink
        signature={p.testPayment.signature}
        href={p.testPayment.explorerUrl}
        label="View on Solana devnet"
      />
    ) : undefined,
    at: p.funding?.verifiedAt ?? p.testPayment?.detectedAt ?? null,
  });
  if (p.platformFee) {
    const settled = p.platformFee.settled;
    steps.push({
      key: "fee",
      label: "LamportPay fee settled",
      state: settled === true ? "done" : settled === false ? "skipped" : "pending",
      detail:
        settled === false ? (
          "Not included in the transaction"
        ) : p.funding && settled ? (
          <TxLink signature={p.funding.signature} label="Same transaction" />
        ) : undefined,
    });
  }
  steps.push({
    key: "deposit",
    label: "Deposit received by the payout partner",
    state: p.simulatedDeposit && rank(p.status) < 2 ? "done" : stepFromRank(p, 1, 2),
    detail: p.transferId ? `Reference ${p.transferId}` : undefined,
    at: transitionAt(p, "FUNDS_COLLECTED"),
  });
  steps.push({
    key: "conversion",
    label: "Converting to local currency",
    state: stepFromRank(p, 3, 4),
    at: transitionAt(p, "IN_PROGRESS"),
  });
  steps.push({
    key: "payout",
    label: "Bank payout",
    state: stepFromRank(p, 4, 6),
    at: transitionAt(p, "PAYMENT_SUBMITTED"),
  });
  steps.push({
    key: "completed",
    label: "Completed",
    state: p.status === "COMPLETED" ? "done" : FAILED.has(p.status) ? "failed" : "pending",
    at: p.completedAt,
  });
  return steps;
}

const ICON: Record<StepState, ReactNode> = {
  done: <Check className="w-3.5 h-3.5" />,
  current: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
  pending: <CircleDashed className="w-3.5 h-3.5" />,
  failed: <X className="w-3.5 h-3.5" />,
  skipped: <CircleDashed className="w-3.5 h-3.5" />,
};

const DOT: Record<StepState, string> = {
  done: "bg-foreground text-background",
  current: "bg-primary text-primary-foreground",
  pending: "bg-muted text-muted-foreground",
  failed: "bg-destructive text-white",
  skipped: "bg-muted text-muted-foreground",
};

export function StatusTimeline({ payment }: { payment: PaymentView }) {
  const steps = statusSteps(payment);
  return (
    <ol className="relative">
      {steps.map((step, i) => (
        <li key={step.key} className="flex gap-3 pb-4 last:pb-0">
          <div className="flex flex-col items-center">
            <span className={`grid place-items-center w-6 h-6 rounded-full ${DOT[step.state]}`}>
              {ICON[step.state]}
            </span>
            {i < steps.length - 1 && <span className="flex-1 w-px bg-border mt-1" />}
          </div>
          <div className="pb-1 min-w-0">
            <div
              className={`text-sm ${
                step.state === "pending" || step.state === "skipped"
                  ? "text-muted-foreground"
                  : "font-medium"
              }`}
            >
              {step.label}
            </div>
            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2 break-all">
              {step.detail}
              {step.at && step.state !== "pending" && (
                <span>{new Date(step.at).toLocaleString()}</span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
