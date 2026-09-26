import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/Layout";
import {
  CORRIDORS,
  PAYOUT_METHODS,
  SENDER_CURRENCIES,
  TOKENS,
  type Token,
  calcQuote,
  fmt,
  mockPayoutRef,
  mockPaymentId,
  mockSolanaHash,
} from "@/components/site/demo-data";
import { useCallback, useMemo, useState, useEffect } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { LammySays, LammyCheck, LAMMY_INTRO, LAMMY_SAFETY } from "@/components/site/Lammy";
import { SwapPanelIsland, WalletPanelIsland } from "@/components/site/wallet/WalletIsland";
import type { SwapExecution } from "@/components/site/wallet/SwapPanel";
import { SwapRoutePreviewCard } from "@/components/site/SwapRoutePreview";
import { IntegrationStatusPanel } from "@/components/site/IntegrationStatusPanel";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/send")({
  head: () =>
    pageSeo({
      path: "/send",
      title: "Send a Demo Transfer | LamportPay",
      description:
        "Walk through a crypto-to-local-currency transfer demo: itemised quote, simulated identity check, settlement tracking and receipt.",
    }),
  component: SendPage,
});

type Step = 1 | 2 | 3 | 4 | 5 | 6;

/** A real SOL → USDC swap used as this payment's settlement transaction. */
type Settlement = {
  signature: string;
  status: "verifying" | "verified" | "failed";
  usdcReceived: number | null;
  explorerUrl: string | null;
  error: string | null;
};

type VerifyResponse = {
  found?: boolean;
  success?: boolean;
  usdcUiDelta?: number;
  explorerUrl?: string;
  error?: string | null;
};

/**
 * Confirms the swap on mainnet via /api/solana/verify-tx. A just-executed
 * transaction can take a few seconds to become queryable, so a 404 is retried.
 */
async function verifySwap(
  execution: SwapExecution,
): Promise<Pick<Settlement, "status" | "usdcReceived" | "explorerUrl" | "error">> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch("/api/solana/verify-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signature: execution.signature,
          cluster: "mainnet-beta",
          owner: execution.owner,
        }),
      });
      const data = (await res.json()) as VerifyResponse;
      if (res.status === 404) continue;
      const verified = res.ok && data.found === true && data.success === true;
      return {
        status: verified ? "verified" : "failed",
        usdcReceived: verified ? (data.usdcUiDelta ?? null) : null,
        explorerUrl: data.explorerUrl ?? null,
        error: verified ? null : (data.error ?? "Swap could not be verified on-chain."),
      };
    } catch {
      return {
        status: "failed",
        usdcReceived: null,
        explorerUrl: null,
        error: "Could not reach the verification endpoint.",
      };
    }
  }
  return {
    status: "failed",
    usdcReceived: null,
    explorerUrl: null,
    error: "Swap not found on mainnet yet. Check it on the explorer.",
  };
}

export default function SendPage() {
  const [step, setStep] = useState<Step>(1);
  const [amount, setAmount] = useState("500");
  const [token, setToken] = useState<Token>("USDC");
  const [senderCurrency, setSenderCurrency] = useState<string>("USD");
  const [corridorIdx, setCorridorIdx] = useState(0);
  const [recipientName, setRecipientName] = useState("Ayesha Khan");
  const [method, setMethod] = useState<(typeof PAYOUT_METHODS)[number]>("Bank account");
  const [recipientDetails, setRecipientDetails] = useState("Mock Bank • •••• 4821");
  const [kycApproved, setKycApproved] = useState(false);
  const [paymentId, setPaymentId] = useState("");
  const [payoutRef, setPayoutRef] = useState("");
  const [txHash, setTxHash] = useState("");
  const [trackIdx, setTrackIdx] = useState(0);
  const [settlement, setSettlement] = useState<Settlement | null>(null);

  const corridor = CORRIDORS[corridorIdx];
  const quote = useMemo(
    () => calcQuote(parseFloat(amount) || 0, token, corridor.currency),
    [amount, token, corridor.currency],
  );

  const timeline = [
    "Payment created",
    "Regulated settlement partner selected",
    "Mock partner KYC approved",
    "Crypto converted to USDC",
    "USDC settlement confirmed",
    "Payout request sent to settlement partner",
    "Partner processing payout",
    "Recipient paid",
  ];

  useEffect(() => {
    if (step !== 5) return;
    setTrackIdx(0);
    const id = setInterval(() => {
      setTrackIdx((i) => {
        if (i >= timeline.length - 1) {
          clearInterval(id);
          return i;
        }
        return i + 1;
      });
    }, 700);
    return () => clearInterval(id);
  }, [step]);

  const onSwapExecuted = useCallback(async (execution: SwapExecution) => {
    const pending: Settlement = {
      signature: execution.signature,
      status: "verifying",
      usdcReceived: null,
      explorerUrl: null,
      error: null,
    };
    setSettlement(pending);
    const verified = await verifySwap(execution);
    // Ignore late results if another swap replaced this one meanwhile.
    setSettlement((s) => (s?.signature === execution.signature ? { ...pending, ...verified } : s));
  }, []);

  return (
    <SiteLayout>
      <div className="max-w-5xl mx-auto px-5 py-14 md:py-20">
        <div className="mb-8">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">
            Demo send flow
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mt-2">
            Send a demo transfer
          </h1>
          <p className="text-muted-foreground mt-2">
            Six steps, all mock data. No real crypto, KYC, or fiat moves in this demo.
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-5 mb-6 flex flex-col md:flex-row md:items-center gap-4 justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-sm">This walkthrough is a simulation</div>
              <p className="text-xs text-muted-foreground mt-1">
                Nothing here contacts a payout partner. Real payments run through Stables on the
                signed-in payment page.
              </p>
            </div>
          </div>
          <Link
            to="/pay"
            className="inline-flex items-center gap-2 rounded-full bg-card border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition"
          >
            Real payment <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <Stepper
          current={step}
          labels={["Details", "Quote", "KYC", "Confirm", "Tracking", "Receipt"]}
        />

        <div className="mt-6 space-y-6">
          <IntegrationStatusPanel />
          <SwapRoutePreviewCard />
        </div>

        <div className="mt-8">
          <LammySays size={72} wave={step === 1}>
            {step === 1 && LAMMY_INTRO}
            {step === 2 &&
              "Here's your quote. Every fee is shown before you confirm — nothing is added later."}
            {step === 3 && "Identity checks are done by the licensed partner, never by LamportPay."}
            {step === 4 && `Please double-check the recipient details. ${LAMMY_SAFETY}`}
            {step === 5 &&
              "I'm tracking your payout across the network. This usually settles in under 5 minutes."}
            {step === 6 && "All done — here's your receipt. You can copy it for your records."}
          </LammySays>
        </div>

        <div className="mt-10 rounded-3xl border border-border/60 bg-card shadow-[var(--shadow-soft)] p-6 md:p-10">
          {step === 1 && (
            <div className="space-y-6">
              <SectionTitle title="1. Enter transfer details" />
              <WalletPanelIsland />
              <div className="grid md:grid-cols-2 gap-5">
                <Field label="Token">
                  <select
                    value={token}
                    onChange={(e) => setToken(e.target.value as Token)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5"
                  >
                    {TOKENS.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Amount">
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5"
                  />
                </Field>
                <Field label="Sender currency (display)">
                  <select
                    value={senderCurrency}
                    onChange={(e) => setSenderCurrency(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5"
                  >
                    {SENDER_CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Receiver country">
                  <select
                    value={corridorIdx}
                    onChange={(e) => setCorridorIdx(parseInt(e.target.value))}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5"
                  >
                    {CORRIDORS.map((c, i) => (
                      <option key={c.currency} value={i}>
                        {c.flag} {c.country}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Receiver currency">
                  <div className="w-full rounded-xl border border-border bg-secondary px-3 py-2.5 font-semibold">
                    {corridor.currency}
                  </div>
                </Field>
                <Field label="Payout method">
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as (typeof PAYOUT_METHODS)[number])}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5"
                  >
                    {PAYOUT_METHODS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Recipient name">
                  <input
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5"
                  />
                </Field>
                <Field label="Mock recipient details">
                  <input
                    value={recipientDetails}
                    onChange={(e) => setRecipientDetails(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5"
                  />
                </Field>
              </div>
              <PrimaryButton
                onClick={() => {
                  setPaymentId(mockPaymentId());
                  setStep(2);
                }}
              >
                Get Payout Quote <ArrowRight className="w-4 h-4" />
              </PrimaryButton>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <SectionTitle title="2. Payout quote" />
              <div className="grid md:grid-cols-2 gap-3">
                <KV k="Provider" v="Regulated payout partner (TBD)" />
                <KV k="Provider type" v="Stablecoin orchestration / settlement partner" />
                <KV k="Input token" v={token} />
                <KV k="Input amount" v={amount} />
                <KV k="Estimated USDC settlement" v={`${fmt(quote.usdcSettlement)} USDC`} />
                <KV
                  k="FX rate"
                  v={`1 USD = ${fmt(quote.fxRate, quote.fxRate > 100 ? 0 : 2)} ${corridor.currency}`}
                />
                <KV k="Partner payout fee" v={`$${fmt(quote.payoutFee)}`} />
                <KV k="LamportPay platform fee" v={`$${fmt(quote.platformFee)}`} />
                <KV k="Total fee" v={`$${fmt(quote.totalFee)}`} />
                <KV
                  k="Recipient receives"
                  v={`${fmt(quote.recipientAmount)} ${corridor.currency}`}
                />
                <KV k="Estimated delivery" v="Under 5 minutes" />
                <KV k="KYC method" v="Partner-hosted KYC" />
                <KV k="Payout method" v={method} />
                <KV k="Corridor support" v="Demo supported" />
              </div>
              <div className="text-xs text-muted-foreground">
                Status note: Mock quote for demo only.
              </div>
              <NavButtons
                onBack={() => setStep(1)}
                onNext={() => setStep(3)}
                nextLabel="Continue to Partner KYC"
              />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <SectionTitle title="3. Partner KYC" />
              <div className="rounded-2xl bg-secondary/60 p-5 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <p className="text-sm leading-relaxed">
                  Identity verification is handled by <strong>a regulated payout partner</strong> or
                  the selected licensed payout partner, not by LamportPay.
                </p>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <KV k="Selected partner" v="Regulated payout partner (TBD)" />
                <KV k="KYC status" v={kycApproved ? "Approved" : "Not started"} />
              </div>
              {kycApproved && <LammyCheck label="Mock KYC approved by settlement partner" />}
              {!kycApproved ? (
                <PrimaryButton onClick={() => setKycApproved(true)}>
                  Complete Mock partner KYC
                </PrimaryButton>
              ) : (
                <NavButtons
                  onBack={() => setStep(2)}
                  onNext={() => setStep(4)}
                  nextLabel="Confirm Demo Payment"
                />
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <SectionTitle title="4. Payment confirmation" />
              <div className="grid md:grid-cols-2 gap-3">
                <KV k="Input token" v={token} />
                <KV k="Input amount" v={amount} />
                <KV k="Estimated USDC settlement" v={`${fmt(quote.usdcSettlement)} USDC`} />
                <KV k="Receiver country" v={corridor.country} />
                <KV k="Receiver currency" v={corridor.currency} />
                <KV k="Recipient name" v={recipientName} />
                <KV k="Selected partner" v="Regulated payout partner (TBD)" />
                <KV k="Partner payout fee" v={`$${fmt(quote.payoutFee)}`} />
                <KV k="LamportPay fee" v={`$${fmt(quote.platformFee)}`} />
                <KV
                  k="Recipient receives"
                  v={`${fmt(quote.recipientAmount)} ${corridor.currency}`}
                />
                <KV k="Estimated delivery" v="Under 5 minutes" />
                <KV k="Payout method" v={method} />
              </div>
              <div className="rounded-2xl border border-border/60 p-5 space-y-4">
                <div>
                  <div className="text-sm font-semibold">
                    Optional: settle with a real SOL → USDC swap
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Swaps 0.001–0.01 SOL on Solana mainnet through Jupiter. The USDC returns to your
                    own wallet. If you swap, the receipt uses that on-chain transaction instead of a
                    mock hash.
                  </p>
                </div>
                <SwapPanelIsland onExecuted={onSwapExecuted} />
                {settlement && <SettlementStatus settlement={settlement} />}
              </div>
              <PrimaryButton
                onClick={() => {
                  setTxHash(settlement?.signature ?? mockSolanaHash());
                  setPayoutRef(mockPayoutRef());
                  setStep(5);
                }}
              >
                Simulate Payment
              </PrimaryButton>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-6">
              <SectionTitle title="5. Tracking" />
              <ol className="relative border-l-2 border-border/70 ml-2">
                {timeline.map((t, i) => {
                  const done = i <= trackIdx;
                  return (
                    <li key={t} className="ml-6 pb-6 last:pb-0">
                      <span
                        className={
                          "absolute -left-[11px] w-5 h-5 rounded-full flex items-center justify-center border-2 " +
                          (done
                            ? "bg-primary border-primary text-white"
                            : "bg-background border-border")
                        }
                      >
                        {done && <Check className="w-3 h-3" />}
                      </span>
                      <div className={done ? "font-medium" : "text-muted-foreground"}>{t}</div>
                    </li>
                  );
                })}
              </ol>
              {trackIdx >= timeline.length - 1 && (
                <PrimaryButton onClick={() => setStep(6)}>
                  See receipt <ArrowRight className="w-4 h-4" />
                </PrimaryButton>
              )}
            </div>
          )}

          {step === 6 && (
            <Receipt
              paymentId={paymentId}
              token={token}
              amount={amount}
              quote={quote}
              corridor={corridor}
              recipientName={recipientName}
              method={method}
              payoutRef={payoutRef}
              txHash={txHash}
              settlement={settlement}
              onReset={() => {
                setSettlement(null);
                setStep(1);
                setKycApproved(false);
                setPaymentId("");
                setPayoutRef("");
                setTxHash("");
              }}
            />
          )}
        </div>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          <Link to="/how-it-works" className="text-primary hover:underline">
            How the flow works →
          </Link>
        </div>
      </div>
    </SiteLayout>
  );
}

type ReceiptProps = {
  paymentId: string;
  token: Token;
  amount: string;
  quote: ReturnType<typeof calcQuote>;
  corridor: (typeof CORRIDORS)[number];
  recipientName: string;
  method: string;
  payoutRef: string;
  txHash: string;
  settlement: Settlement | null;
  onReset: () => void;
};

function Receipt(props: ReceiptProps) {
  const {
    paymentId,
    token,
    amount,
    quote,
    corridor,
    recipientName,
    method,
    payoutRef,
    txHash,
    settlement,
    onReset,
  } = props;
  // Only a swap whose signature became this receipt's tx counts as real settlement.
  const realTx = settlement?.signature === txHash ? settlement : null;
  const txLabel = !realTx
    ? "Mock Solana tx"
    : realTx.status === "verified"
      ? "Solana tx (verified on mainnet)"
      : realTx.status === "verifying"
        ? "Solana tx (verifying…)"
        : "Solana tx (unverified)";
  const [copied, setCopied] = useState(false);
  const receiptText = [
    `Payment ID: ${paymentId}`,
    `Input: ${amount} ${token}`,
    `USDC settlement: ${fmt(quote.usdcSettlement)} USDC`,
    `Recipient: ${recipientName}`,
    `Country: ${corridor.country} (${corridor.currency})`,
    `Recipient receives: ${fmt(quote.recipientAmount)} ${corridor.currency}`,
    `Partner: regulated payout partner (TBD)`,
    `Payout reference: ${payoutRef}`,
    `Partner payout fee: $${fmt(quote.payoutFee)}`,
    `LamportPay fee: $${fmt(quote.platformFee)}`,
    `FX rate: 1 USD = ${fmt(quote.fxRate, quote.fxRate > 100 ? 0 : 2)} ${corridor.currency}`,
    `Payout method: ${method}`,
    `${txLabel}: ${txHash}`,
    realTx?.usdcReceived != null ? `On-chain USDC received: ${fmt(realTx.usdcReceived, 6)}` : "",
    `Status: Paid`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="space-y-6">
      <SectionTitle title="6. Receipt" />
      <div className="rounded-2xl bg-[image:var(--gradient-card)] border border-border/60 p-6">
        <div className="mb-5">
          <LammyCheck label="Payout complete — recipient has been paid" />
        </div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Payment ID
            </div>
            <div className="font-mono text-sm">{paymentId}</div>
          </div>
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-[color:var(--success)]/15 text-[color:var(--success)]">
            PAID
          </span>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <KV k="Input token" v={token} />
          <KV k="Input amount" v={amount} />
          <KV k="USDC settlement" v={`${fmt(quote.usdcSettlement)} USDC`} />
          <KV k="Receiver country" v={corridor.country} />
          <KV k="Receiver currency" v={corridor.currency} />
          <KV k="Recipient name" v={recipientName} />
          <KV k="Recipient receives" v={`${fmt(quote.recipientAmount)} ${corridor.currency}`} />
          <KV k="Selected partner" v="Regulated payout partner (TBD)" />
          <KV k="Payout reference" v={<span className="font-mono text-xs">{payoutRef}</span>} />
          <KV k="Partner payout fee" v={`$${fmt(quote.payoutFee)}`} />
          <KV k="LamportPay platform fee" v={`$${fmt(quote.platformFee)}`} />
          <KV
            k="FX rate used"
            v={`1 USD = ${fmt(quote.fxRate, quote.fxRate > 100 ? 0 : 2)} ${corridor.currency}`}
          />
          <KV k="Payout method" v={method} />
          <KV
            k={txLabel}
            v={
              realTx?.explorerUrl ? (
                <a
                  href={realTx.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[10px] break-all text-primary hover:underline"
                >
                  {txHash}
                </a>
              ) : (
                <span className="font-mono text-[10px] break-all">{txHash}</span>
              )
            }
          />
          {realTx?.usdcReceived != null && (
            <KV k="On-chain USDC received" v={`${fmt(realTx.usdcReceived, 6)} USDC`} />
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 font-semibold hover:opacity-90 transition"
        >
          Start new payment
        </button>
        <button
          onClick={() => {
            navigator.clipboard.writeText(receiptText);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-2 rounded-full bg-card border border-border px-5 py-2.5 font-semibold hover:bg-secondary transition"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4" /> Copied
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" /> Copy receipt details
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function SettlementStatus({ settlement }: { settlement: Settlement }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/40 px-4 py-3 text-sm space-y-1">
      <div className="flex items-center gap-2 font-semibold">
        {settlement.status === "verifying" && <Loader2 className="w-4 h-4 animate-spin" />}
        {settlement.status === "verified" && (
          <Check className="w-4 h-4 text-[color:var(--success)]" />
        )}
        {settlement.status === "failed" && <AlertCircle className="w-4 h-4 text-destructive" />}
        {settlement.status === "verifying"
          ? "Verifying swap on mainnet…"
          : settlement.status === "verified"
            ? "Swap verified — this transaction will be used as settlement"
            : "Swap could not be verified"}
      </div>
      {settlement.usdcReceived != null && (
        <div className="text-xs text-muted-foreground">
          USDC received: {fmt(settlement.usdcReceived, 6)}
        </div>
      )}
      {settlement.error && <div className="text-xs text-destructive">{settlement.error}</div>}
      {settlement.explorerUrl && (
        <a
          href={settlement.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          View on explorer <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

function Stepper({ current, labels }: { current: number; labels: string[] }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      {labels.map((l, i) => {
        const n = i + 1;
        const active = n === current;
        const done = n < current;
        return (
          <div key={l} className="flex items-center gap-2 shrink-0">
            <div
              className={
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold " +
                (done
                  ? "bg-primary text-white"
                  : active
                    ? "bg-foreground text-background"
                    : "bg-secondary text-muted-foreground")
              }
            >
              {done ? <Check className="w-3.5 h-3.5" /> : n}
            </div>
            <div className={"text-sm " + (active ? "font-semibold" : "text-muted-foreground")}>
              {l}
            </div>
            {i < labels.length - 1 && <div className="w-6 h-px bg-border mx-1" />}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-secondary/60 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {k}
      </div>
      <div className="font-semibold mt-0.5 break-words">{v}</div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>;
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full bg-[image:var(--gradient-hero)] text-white px-6 py-3 font-semibold shadow-[var(--shadow-soft)] hover:opacity-95 transition"
    >
      {children}
    </button>
  );
}

function NavButtons({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-full bg-card border border-border px-5 py-2.5 font-semibold hover:bg-secondary transition"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <PrimaryButton onClick={onNext}>
        {nextLabel} <ArrowRight className="w-4 h-4" />
      </PrimaryButton>
    </div>
  );
}
