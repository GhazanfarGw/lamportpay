import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { SiteLayout } from "@/components/site/Layout";
import { PaymentReceipt } from "@/components/site/PaymentReceipt";
import {
  FundingPanelIsland,
  PaymentSwapIsland,
  WalletKeyIsland,
} from "@/components/site/wallet/WalletIsland";
import { formatMinor } from "@/lib/money";
import { PaymentApiError, paymentApi, type FieldIssue } from "@/lib/payments/api-client";
import type { KycStatus, PaymentView } from "@/lib/payments/view";
import {
  BANK_DETAIL_FIELDS,
  PURPOSE_CODES,
  type BankDetailField,
  type PurposeCode,
} from "@/lib/stables/types";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "@/lib/tokens";

const OWN_ACCOUNT_MESSAGE = "Payouts can only be sent to a bank account in your own name.";

type Limits = Partial<Record<PaymentCurrency, { min: string; max: string | null } | null>>;

/** "1000000" → "1,000,000". */
function grouped(major: string) {
  const [whole, fraction] = major.split(".");
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}

export const Route = createFileRoute("/_authenticated/pay")({
  validateSearch: (search: Record<string, unknown>): { payment?: string } => ({
    ...(typeof search.payment === "string" && { payment: search.payment }),
  }),
  head: () => ({
    meta: [
      { title: "Send a payment | LamportPay" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PayPage,
});

const STATUS_LABELS: Record<string, string> = {
  PAYMENT_CREATED: "Created — verify your identity",
  KYC_PENDING: "Waiting for identity verification",
  KYC_APPROVED: "Identity verified — get a quote",
  QUOTED: "Quoted — add your bank account",
  KYC_REJECTED: "Identity verification rejected",
  CREATED: "Transfer created — send your deposit",
  AWAITING_FUNDS_COLLECTION: "Waiting for your deposit",
  FUNDS_COLLECTED: "Deposit received by Stables",
  COMPLIANCE_HOLD: "On hold for compliance review",
  IN_PROGRESS: "Converting to local currency",
  PAYMENT_SUBMITTED: "Payout sent to your bank",
  PAYMENT_PROCESSED: "Bank confirmed the payout",
  COMPLETED: "Completed — paid into your account",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired before funds arrived",
};

const FUNDABLE = new Set(["CREATED", "AWAITING_FUNDS_COLLECTION"]);

/** Timeline labels for events that are not status changes. */
const EVENT_LABELS: Record<string, string> = {
  travel_rule_verification_required: "Stables asked you to verify your sending wallet",
  travel_rule_cleared: "Wallet verification done — Stables released the transfer",
  funding_verified: "Deposit confirmed on Solana",
  funding_rejected: "Deposit not accepted",
  sandbox_deposit_simulated: "Deposit simulated (Stables sandbox)",
  payout_settled: "Final payout amount recorded",
};

function money(minor: string | null, currency: string) {
  return minor === null ? "—" : `${formatMinor(BigInt(minor), currency)} ${currency.toUpperCase()}`;
}

function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Current time, ticking every `intervalMs`. */
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function remaining(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  const seconds = Math.floor(ms / 1000) % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function PayPage() {
  const { payment } = Route.useSearch();
  const status = useQuery({
    queryKey: ["integration-status"],
    queryFn: async () => {
      const res = await fetch("/api/integration-status");
      return (await res.json()) as {
        providers: Array<{ name: string; mode: string }>;
        guards?: {
          paymentLimits?: Limits;
          paymentCurrencies?: PaymentCurrency[];
          platformFeeBps?: number | null;
        };
      };
    },
  });
  const stablesMode = status.data?.providers.find((p) => p.name === "Stables")?.mode;
  const limits = status.data?.guards?.paymentLimits ?? {};
  const coins = status.data?.guards?.paymentCurrencies ?? [...PAYMENT_CURRENCIES];
  const feeBps = status.data?.guards?.platformFeeBps ?? null;
  const coinText = coins.map((c) => c.toUpperCase()).join(" / ");

  return (
    <SiteLayout>
      <div className="max-w-4xl mx-auto px-5 py-14 md:py-20 space-y-6">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">
              {coinText} → local currency
            </div>
            <Link to="/payments" className="text-sm text-primary hover:underline">
              Payment history
            </Link>
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mt-2">Send a payment</h1>
          <p className="text-muted-foreground mt-2">
            You send {coins.map((c) => c.toUpperCase()).join(" or ")} from your own wallet straight
            to a single-use deposit address from Stables, our licensed payout partner. Stables
            verifies your identity, converts, and pays out to your own bank account. LamportPay
            never holds your funds.
          </p>
        </div>

        {stablesMode === "mock" && (
          <Notice tone="warn">
            Payments are unavailable: Stables is not configured on this server.
          </Notice>
        )}
        {stablesMode === "sandbox" && (
          <Notice tone="info">
            Stables sandbox: sending from a wallet is disabled because sandbox deposit addresses are
            not real. An admin simulates the deposit from the admin console instead.
          </Notice>
        )}

        <KycCard />
        {payment ? (
          <PaymentPanel paymentId={payment} stablesMode={stablesMode} />
        ) : (
          <NewPaymentForm limits={limits} coins={coins} feeBps={feeBps} />
        )}
      </div>
    </SiteLayout>
  );
}

// ---------------------------------------------------------------------- KYC

function KycCard() {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const kyc = useQuery({
    queryKey: ["kyc"],
    queryFn: async () => (await paymentApi<KycStatus>("/api/kyc")).data,
  });
  const start = useMutation({
    mutationFn: async () =>
      (await paymentApi<KycStatus>("/api/kyc", { method: "POST", body: { firstName, lastName } }))
        .data,
    onSuccess: (data) => {
      queryClient.setQueryData(["kyc"], data);
      if (data.kycLink) window.open(data.kycLink, "_blank", "noopener");
    },
  });

  const data = kyc.data;
  const approved = data?.status === "approved" && data.basePayout === "approved";

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="w-5 h-5 text-primary" />
          Identity verification
        </div>
        <button
          onClick={() => void kyc.refetch()}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${kyc.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {kyc.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {kyc.error && <ErrorText error={kyc.error} />}

      {data && approved && (
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="w-4 h-4 text-[color:var(--success)]" />
          {data.verifiedName
            ? `Verified by Stables as ${data.verifiedName}. You can send payments to your own bank account.`
            : "Verified by Stables. You can send payments."}
        </div>
      )}

      {data && !approved && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Stables verifies your identity on its own secure page. LamportPay never sees your
            documents.{" "}
            {data.status === "not_started"
              ? ""
              : `Status: ${data.status.replace("_", " ")}${
                  data.basePayout ? `, payouts ${data.basePayout.replace("_", " ")}` : ""
                }.`}
          </p>
          {data.subStatus.length > 0 && (
            <p className="text-sm">
              Stables needs: {data.subStatus.join(", ").toLowerCase().replace(/_/g, " ")}
            </p>
          )}
          {data.status === "rejected" ? (
            <Notice tone="warn">
              Stables rejected the verification. Payments are not possible.
            </Notice>
          ) : (
            <>
              {data.status === "not_started" && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="First name (as on your ID)">
                    <input
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className={INPUT}
                    />
                  </Field>
                  <Field label="Last name (as on your ID)">
                    <input
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className={INPUT}
                    />
                  </Field>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => start.mutate()}
                  disabled={
                    start.isPending ||
                    (data.status === "not_started" && (!firstName.trim() || !lastName.trim()))
                  }
                  className={PRIMARY}
                >
                  {start.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {data.status === "not_started" ? "Verify with Stables" : "Continue verification"}
                  <ExternalLink className="w-4 h-4" />
                </button>
                {data.kycLink && (
                  <a
                    href={data.kycLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    Open verification page
                  </a>
                )}
              </div>
              {start.error && <ErrorText error={start.error} />}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------- new payment

/** Region codes that are not countries (groupings, pseudo-locales). */
const NON_COUNTRY_REGIONS = new Set(["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ"]);

/**
 * Whether `code` is the current code for its region. Retired or alias codes
 * (UK → GB, FX → FR, DD → DE, ZR → CD…) share a display name with the current
 * one, and Stables refuses them.
 */
function isCanonicalRegion(code: string) {
  try {
    return Intl.getCanonicalLocales(`und-${code}`)[0] === `und-${code}`;
  } catch {
    return false;
  }
}

/**
 * Every country and ISO currency the browser knows. LamportPay keeps no list of
 * corridors: Stables prices the choice and says whether it can pay out there.
 */
function useDestinationOptions() {
  return useMemo(() => {
    const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
    const countries: Array<{ code: string; name: string }> = [];
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        const name = regionNames.of(code);
        if (name && name !== code && !NON_COUNTRY_REGIONS.has(code) && isCanonicalRegion(code)) {
          countries.push({ code, name });
        }
      }
    }
    countries.sort((x, y) => x.name.localeCompare(y.name));

    const currencyNames = new Intl.DisplayNames(["en"], { type: "currency", fallback: "none" });
    const currencies = Intl.supportedValuesOf("currency").map((code) => ({
      code,
      name: currencyNames.of(code) ?? code,
    }));
    return { countries, currencies };
  }, []);
}

type Preference = "auto" | PaymentCurrency;

function NewPaymentForm({
  limits: allLimits,
  coins,
  feeBps,
}: {
  limits: Limits;
  /** Payment coins turned on (business settings). */
  coins: PaymentCurrency[];
  /** LamportPay's conversion fee, shown before the payment starts. */
  feeBps: number | null;
}) {
  const navigate = useNavigate();
  const { countries, currencies } = useDestinationOptions();
  const [amount, setAmount] = useState("");
  const [preference, setPreference] = useState<Preference>("auto");
  const [walletKey, setWalletKey] = useState<string | null>(null);
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("");
  const single = coins.length === 1 ? coins[0]! : null;
  const chosen: Preference = single ?? preference;
  const limits =
    allLimits[chosen === "auto" ? (coins[0] ?? PAYMENT_CURRENCIES[0]) : chosen] ?? null;
  const coin =
    chosen === "auto" ? coins.map((c) => c.toUpperCase()).join(" or ") : chosen.toUpperCase();

  const create = useMutation({
    mutationFn: async () =>
      (
        await paymentApi<PaymentView>("/api/payments", {
          method: "POST",
          body: {
            amount,
            preferredCurrency: chosen,
            country,
            currency: currency.toLowerCase(),
            ...(walletKey && { wallet: walletKey }),
          },
        })
      ).data,
    onSuccess: (payment) => void navigate({ to: "/pay", search: { payment: payment.id } }),
  });

  return (
    <Card>
      <div className="font-semibold">New payment</div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={`You send (${coin} on Solana)`}>
            <div className="flex gap-2">
              <input
                inputMode="decimal"
                placeholder={limits?.min ?? ""}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className={INPUT}
              />
              {!single && (
                <select
                  aria-label="Pay with"
                  value={preference}
                  onChange={(e) => setPreference(e.target.value as Preference)}
                  className={`${INPUT} w-auto`}
                >
                  <option value="auto">Automatic</option>
                  {coins.map((c) => (
                    <option key={c} value={c}>
                      {c.toUpperCase()}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </Field>
          <Field label="Recipient country">
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={INPUT}>
              <option value="">Select…</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payout currency">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={INPUT}
            >
              <option value="">Select…</option>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="text-sm text-muted-foreground">
          Paid out to a bank account in your own name.{" "}
          {limits &&
            (limits.max
              ? `Payments are ${grouped(limits.min)}–${grouped(limits.max)} ${coin}. `
              : `Payments start at ${grouped(limits.min)} ${coin}. `)}
          {feeBps !== null &&
            feeBps > 0 &&
            `A ${feeBps / 100}% LamportPay fee is added on top and shown in your quote. `}
          Stables checks whether it can pay out to this country and currency, and whether it accepts
          the amount, before anything is created.
        </p>
        <div className="space-y-2">
          <div className="text-sm font-medium">
            Connect your wallet so we can use what you already hold
          </div>
          <p className="text-xs text-muted-foreground">
            Optional. Connecting shares only your public address; nothing is signed. With Automatic,
            we pick the coin you already hold that pays out best, and only suggest a swap if you
            hold neither.
          </p>
          <WalletKeyIsland onChange={setWalletKey} />
        </div>
        <button
          type="submit"
          disabled={create.isPending || !amount || !country || !currency}
          className={PRIMARY}
        >
          {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Start payment <ArrowRight className="w-4 h-4" />
        </button>
        {create.error && <ErrorText error={create.error} />}
      </form>
    </Card>
  );
}

// ----------------------------------------------------------------- payment

function PaymentPanel({ paymentId, stablesMode }: { paymentId: string; stablesMode?: string }) {
  const queryClient = useQueryClient();
  const key = ["payment", paymentId];
  const payment = useQuery({
    queryKey: key,
    queryFn: async () => (await paymentApi<PaymentView>(`/api/payments/${paymentId}`)).data,
    refetchInterval: (query) => (query.state.data?.terminal ? false : 5000),
  });
  const setPayment = (p: PaymentView) => queryClient.setQueryData(key, p);
  // Shares the KycCard's query: the verified name locks the account holder.
  const kyc = useQuery({
    queryKey: ["kyc"],
    queryFn: async () => (await paymentApi<KycStatus>("/api/kyc")).data,
  });

  const quote = useMutation({
    mutationFn: async () =>
      (await paymentApi<PaymentView>(`/api/payments/${paymentId}/quote`, { method: "POST" })).data,
    onSuccess: (p) => {
      setPayment(p);
      void queryClient.invalidateQueries({ queryKey: ["kyc"] });
    },
  });

  const p = payment.data;
  if (payment.isLoading)
    return (
      <Card>
        <p className="text-sm text-muted-foreground">Loading payment…</p>
      </Card>
    );
  if (payment.error || !p)
    return (
      <Card>
        <ErrorText error={payment.error ?? new Error("Payment not found.")} />
      </Card>
    );

  const preTransfer = ["PAYMENT_CREATED", "KYC_PENDING", "KYC_APPROVED", "QUOTED"].includes(
    p.status,
  );
  const walletCheck = p.travelRule?.status === "required" || p.travelRule?.status === "expired";

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Payment</div>
            <div className="font-mono text-xs">{p.id}</div>
          </div>
          <span
            className={`text-xs font-semibold px-3 py-1 rounded-full ${
              walletCheck
                ? "bg-[color:var(--warning)]/20 text-foreground"
                : p.status === "COMPLETED"
                  ? "bg-[color:var(--success)]/15 text-[color:var(--success)]"
                  : p.terminal
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/10 text-primary"
            }`}
          >
            {walletCheck
              ? "Action needed — verify your wallet"
              : (STATUS_LABELS[p.status] ?? p.status)}
          </span>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {p.platformFee ? (
            <>
              <KV k="Amount converted" v={money(p.source.amountMinor, p.source.currency)} />
              <KV
                k={`LamportPay fee (${p.platformFee.bps / 100}%)`}
                v={money(p.platformFee.amountMinor, p.platformFee.currency)}
              />
              <KV
                k="Total from your wallet"
                v={money(p.totalToPay.amountMinor, p.totalToPay.currency)}
              />
            </>
          ) : (
            <KV k="You send" v={money(p.source.amountMinor, p.source.currency)} />
          )}
          {p.actualPayout ? (
            <KV
              k="Your bank account received"
              v={money(p.actualPayout.amountMinor, p.actualPayout.currency)}
            />
          ) : (
            <KV
              k={
                p.quote || p.transferId
                  ? "Your bank account gets (quoted)"
                  : "Your bank account gets (estimate)"
              }
              v={money(p.destination.amountMinor, p.destination.currency)}
            />
          )}
          {p.exchangeRate !== null && (
            <KV
              k="Exchange rate"
              v={`1 ${p.source.currency.toUpperCase()} = ${p.exchangeRate} ${p.destination.currency.toUpperCase()}`}
            />
          )}
          {p.fees.map((f) => (
            <KV key={f.kind} k={f.kind.replace(/_/g, " ")} v={money(f.amountMinor, f.currency)} />
          ))}
        </div>
        {p.failureReason && <Notice tone="warn">{p.failureReason}</Notice>}
        {p.payoutEstimateMinutes !== null && !walletCheck && (
          <Notice tone="info">
            Usually reaches your bank within about{" "}
            {p.payoutEstimateMinutes >= 60 && p.payoutEstimateMinutes % 60 === 0
              ? `${p.payoutEstimateMinutes / 60} hour${p.payoutEstimateMinutes === 60 ? "" : "s"}`
              : `${p.payoutEstimateMinutes} minutes`}
            . This is an estimate; each step's actual time appears in the timeline below.
          </Notice>
        )}

        {preTransfer && (
          <div className="space-y-3">
            {p.status === "QUOTED" && p.quote?.expiresAt && (
              <QuoteExpiry expiresAt={p.quote.expiresAt} />
            )}
            <button
              onClick={() => quote.mutate()}
              disabled={quote.isPending}
              className={p.status === "QUOTED" ? SECONDARY : PRIMARY}
            >
              {quote.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {p.status === "QUOTED" ? "Refresh quote" : "Get quote"}
            </button>
            {quote.error && <ErrorText error={quote.error} />}
          </div>
        )}
      </Card>

      {preTransfer && p.settlement && (
        <SettlementCard payment={p} stablesMode={stablesMode} onChanged={setPayment} />
      )}
      {walletCheck && <TravelRuleCard payment={p} onCheck={() => void payment.refetch()} />}
      {p.status === "QUOTED" && (
        <BeneficiaryForm
          payment={p}
          verifiedName={kyc.data?.verifiedName ?? null}
          onCreated={setPayment}
        />
      )}
      {p.deposit && FUNDABLE.has(p.status) && !p.funding && (
        <DepositCard payment={p} onFunded={() => void payment.refetch()} />
      )}
      {p.status === "COMPLETED" && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="w-5 h-5 text-[color:var(--success)]" />
              Paid into your bank account
            </div>
            <Link to="/payments/$id" params={{ id: p.id }} className={PRIMARY}>
              View receipt <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </Card>
      )}
      {p.funding && (
        <Card>
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-5 h-5 text-[color:var(--success)]" />
            Your {p.source.currency.toUpperCase()} deposit is confirmed on Solana
          </div>
          <a
            href={`https://explorer.solana.com/tx/${p.funding.signature}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-mono break-all text-primary hover:underline"
          >
            {p.funding.signature}
          </a>
          <p className="text-sm text-muted-foreground">
            Stables updates the status below as it collects, converts and pays out.
          </p>
        </Card>
      )}

      <Timeline payment={p} />

      <div className="text-center text-sm">
        <Link to="/pay" search={{}} className="text-primary hover:underline">
          Start another payment
        </Link>
      </div>
    </>
  );
}

const SETTLEMENT_TITLES: Record<string, string> = {
  funds_ready: "Ready to pay",
  tentative: "Connect your wallet",
  swap_required: "A swap is needed first",
  needs_sol: "Add SOL for network fees",
  insufficient_funds: "Not enough funds",
};

/**
 * Which coin pays, and why: real balances of the connected wallet and Stables'
 * answer for each coin. The coin can change only before the quote and any swap.
 */
function SettlementCard({
  payment,
  stablesMode,
  onChanged,
}: {
  payment: PaymentView;
  stablesMode?: string;
  onChanged: (p: PaymentView) => void;
}) {
  const s = payment.settlement!;
  const [walletKey, setWalletKey] = useState<string | null>(null);
  const coin = (s.coin ?? payment.source.currency).toUpperCase();
  const canChange =
    ["PAYMENT_CREATED", "KYC_PENDING", "KYC_APPROVED"].includes(payment.status) &&
    !payment.quote &&
    !payment.latestSwap;
  const recheck = useMutation({
    mutationFn: async () =>
      (
        await paymentApi<PaymentView>(`/api/payments/${payment.id}/settlement`, {
          method: "POST",
          body: walletKey ? { wallet: walletKey } : {},
        })
      ).data,
    onSuccess: onChanged,
  });
  const swap = payment.latestSwap;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">
          Paying with {coin} — {SETTLEMENT_TITLES[s.kind] ?? s.kind.replace(/_/g, " ")}
        </div>
        <span className="text-xs text-muted-foreground">
          Checked {new Date(s.checkedAt).toLocaleTimeString()}
        </span>
      </div>
      <p className="text-sm">{s.reason}</p>

      <div className="grid sm:grid-cols-2 gap-3">
        <KV
          k={s.wallet ? `Your wallet ${shortAddress(s.wallet)}` : "Your wallet"}
          v={
            s.holdings?.status === "ok"
              ? [
                  `${s.holdings.sol} SOL`,
                  ...Object.entries(s.holdings.tokens).map(([c, v]) => `${v} ${c.toUpperCase()}`),
                ].join(" · ")
              : s.holdings?.status === "unavailable"
                ? "We couldn't read your wallet"
                : "Not connected"
          }
        />
        {s.candidates.map((c) => (
          <KV
            key={c.coin}
            k={`${c.coin.toUpperCase()} with Stables`}
            v={
              c.verdict === "priced" && c.destinationAmount
                ? `pays out ${c.destinationAmount} ${payment.destination.currency.toUpperCase()}`
                : (c.reason ?? c.verdict.replace(/_/g, " "))
            }
          />
        ))}
      </div>

      {s.kind === "needs_sol" && s.solNeeded && (
        <Notice tone="warn">
          Add at least {s.solNeeded} SOL to your wallet, then check again.
        </Notice>
      )}
      {s.kind === "insufficient_funds" && s.shortfall && (
        <Notice tone="warn">
          Add {s.shortfall} {coin} to your wallet, then check again.
        </Notice>
      )}

      {s.kind === "swap_required" && s.wallet && s.shortfall && (
        <div className="space-y-3">
          {stablesMode !== "live" ? (
            <Notice tone="info">
              Swaps run on Solana mainnet and are disabled with the Stables sandbox, like the
              deposit itself. In production you would swap the missing {s.shortfall} {coin} here.
            </Notice>
          ) : payment.status !== "KYC_APPROVED" ? (
            <Notice tone="info">Verify your identity first; the swap comes after.</Notice>
          ) : (
            <PaymentSwapIsland
              paymentId={payment.id}
              wallet={s.wallet}
              coin={coin}
              shortfall={s.shortfall}
              onChanged={onChanged}
            />
          )}
        </div>
      )}

      {swap && (
        <p className="text-sm text-muted-foreground">
          Last swap:{" "}
          {swap.status === "landed"
            ? `${swap.actualOut} ${swap.outputAsset.toUpperCase()} arrived in your wallet.`
            : swap.status === "submitted"
              ? "being confirmed on Solana."
              : `${swap.status}${swap.failureReason ? ` — ${swap.failureReason}` : ""}.`}
        </p>
      )}

      {canChange && (
        <div className="space-y-3">
          <WalletKeyIsland onChange={setWalletKey} />
          <button
            type="button"
            onClick={() => recheck.mutate()}
            disabled={recheck.isPending}
            className={SECONDARY}
          >
            {recheck.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Check my wallet again
          </button>
          {recheck.error && <ErrorText error={recheck.error} />}
        </div>
      )}
    </Card>
  );
}

/**
 * Travel Rule: Stables holds the transfer until the user proves they own the
 * self-custody wallet the stablecoin came from. Stables has no API to submit that
 * proof, so the check itself runs on its hosted page (opened in a new tab,
 * like identity verification); this card is the step in our flow around it.
 */
function TravelRuleCard({ payment, onCheck }: { payment: PaymentView; onCheck: () => void }) {
  const rule = payment.travelRule!;
  const now = useNow();
  const wallet = payment.funding?.payer ?? payment.payerWallet;
  const left = rule.expiresAt ? Date.parse(rule.expiresAt) - now : null;
  const expired = rule.status === "expired" || (left !== null && left <= 0);

  return (
    <div className="rounded-3xl border-2 border-[color:var(--warning)] bg-card p-6 space-y-4">
      <div className="flex items-center gap-2 font-semibold">
        <Wallet className="w-5 h-5 text-primary" />
        Verify the wallet you paid from
      </div>
      <p className="text-sm text-muted-foreground">
        Under the Travel Rule, Stables must confirm that the self-custody wallet the{" "}
        {(payment.deposit?.currency ?? payment.source.currency).toUpperCase()} came from belongs to
        you. Your transfer is on hold until you do. It is a one-time check on Stables' secure page.
      </p>

      {expired ? (
        <Notice tone="warn">
          The verification link expired before the check was completed, and Stables is still holding
          the transfer.{" "}
          <Link to="/contact" className="underline">
            Contact us
          </Link>{" "}
          and we will ask Stables for a new link.
        </Notice>
      ) : !rule.verificationUrl ? (
        <Notice tone="warn">
          Stables asked for this check but did not send a usable link.{" "}
          <Link to="/contact" className="underline">
            Contact us
          </Link>{" "}
          so we can get one.
        </Notice>
      ) : (
        <>
          <ol className="list-decimal pl-5 space-y-1.5 text-sm">
            <li>
              Open the verification page
              {wallet && (
                <>
                  {" "}
                  and use the wallet you sent from,{" "}
                  <span className="font-mono text-xs">{shortAddress(wallet)}</span> (Phantom or
                  Solflare)
                </>
              )}
              .
            </li>
            <li>
              Follow the steps there. Never enter your seed phrase or private key: no genuine
              verification asks for them.
            </li>
            <li>Come back here. This page updates by itself once Stables releases the transfer.</li>
          </ol>
          {left !== null && (
            <p className="text-sm text-muted-foreground">
              Link valid for {remaining(left)} (until {new Date(rule.expiresAt!).toLocaleString()}).
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={rule.verificationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={PRIMARY}
            >
              Verify wallet with Stables <ExternalLink className="w-4 h-4" />
            </a>
            <button type="button" onClick={onCheck} className={SECONDARY}>
              <RefreshCw className="w-3.5 h-3.5" />
              I've finished — check again
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function QuoteExpiry({ expiresAt }: { expiresAt: string }) {
  const now = useNow();
  const seconds = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  return (
    <p className={`text-sm ${seconds === 0 ? "text-destructive" : "text-muted-foreground"}`}>
      {seconds === 0
        ? "This quote has expired. Refresh it before continuing."
        : `Quote valid for ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.`}
    </p>
  );
}

type BeneficiaryState = {
  bankName: string;
  accountKind: "account_number" | "iban";
  account: string;
  dateOfBirth: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  addressCountry: string;
  details: Partial<Record<BankDetailField, string>>;
  purposeCode: PurposeCode;
};

/** Labels for Stables' optional bank fields. Stables says which a destination needs. */
const DETAIL_LABELS: Record<BankDetailField, string> = {
  account_type: "Account type",
  branch_name: "Branch name",
  swift_code: "SWIFT code",
  bic_code: "BIC",
  ifsc_code: "IFSC code",
  aba_code: "ABA routing number",
  sort_code: "Sort code",
  branch_code: "Branch / transit code",
  bsb_code: "BSB",
  bank_code: "Bank / institution code",
  cnaps: "CNAPS code",
  phone: "Your phone (+country code)",
  name_in_local_language: "Your name in local script",
  national_identification_number: "Your national ID number",
};

const ADDRESS_FIELDS = ["street", "city", "state", "postal_code", "country"] as const;

/** Fields Stables flagged, by its field name (`address.city` also flags `address`). */
function flaggedFields(error: unknown): Map<string, string> {
  const flagged = new Map<string, string>();
  const issues: FieldIssue[] = error instanceof PaymentApiError ? error.fields : [];
  for (const issue of issues) {
    if (!issue.field) continue;
    flagged.set(issue.field, issue.message);
    if (issue.field.startsWith("address")) flagged.set("address", issue.message);
  }
  return flagged;
}

/**
 * The user's own bank account in the payout country. The account holder is the
 * name on the approved Stables record, shown locked; the user enters only the
 * bank details (plus date of birth or address if Stables asks for them).
 * "Review" shows the full payment summary; nothing is sent until "Confirm".
 */
function BeneficiaryForm({
  payment,
  verifiedName,
  onCreated,
}: {
  payment: PaymentView;
  verifiedName: string | null;
  onCreated: (p: PaymentView) => void;
}) {
  const [form, setForm] = useState<BeneficiaryState>({
    bankName: "",
    accountKind: "account_number",
    account: "",
    dateOfBirth: "",
    street: "",
    city: "",
    state: "",
    postalCode: "",
    addressCountry: payment.destination.country,
    details: {},
    purposeCode: "TRANSFER_TO_OWN_ACCOUNT",
  });
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const set = (patch: Partial<BeneficiaryState>) => setForm((f) => ({ ...f, ...patch }));
  const setDetail = (field: BankDetailField, value: string) =>
    setForm((f) => ({ ...f, details: { ...f.details, [field]: value } }));
  const opt = (v: string | undefined) => v?.trim() || undefined;
  const addressStarted = [form.street, form.city, form.state, form.postalCode].some((v) =>
    v.trim(),
  );

  const create = useMutation({
    mutationFn: async () => {
      const details = Object.fromEntries(
        Object.entries(form.details)
          .map(([k, v]) => [k, opt(v)])
          .filter(([, v]) => v),
      );
      return (
        await paymentApi<PaymentView>(`/api/payments/${payment.id}/transfer`, {
          method: "POST",
          body: {
            purposeCode: form.purposeCode,
            beneficiary: {
              bankName: form.bankName.trim(),
              [form.accountKind === "iban" ? "iban" : "accountNumber"]: form.account.trim(),
              dateOfBirth: opt(form.dateOfBirth),
              ...(addressStarted && {
                address: {
                  street: form.street.trim(),
                  city: form.city.trim(),
                  state: form.state.trim(),
                  postalCode: form.postalCode.trim(),
                  country: form.addressCountry.trim(),
                },
              }),
              ...(Object.keys(details).length > 0 && { details }),
            },
          },
        })
      ).data;
    },
    onSuccess: onCreated,
    // Back to the form when Stables names fields to fix; other errors stay on the summary.
    onError: (error) => {
      if (error instanceof PaymentApiError && error.fields.length > 0) setStep("edit");
    },
  });

  // Open or show whatever Stables asked for.
  const flagged = useMemo(() => flaggedFields(create.error), [create.error]);
  useEffect(() => {
    if (BANK_DETAIL_FIELDS.some((f) => flagged.has(f))) setDetailsOpen(true);
  }, [flagged]);
  const showDob = flagged.has("date_of_birth") || Boolean(form.dateOfBirth);
  const showAddress = flagged.has("address") || addressStarted;
  const cls = (field: string) =>
    flagged.has(field) ? `${INPUT} border-destructive ring-1 ring-destructive/40` : INPUT;
  const hint = (field: string) =>
    flagged.has(field) ? (
      <span className="block mt-1 text-xs text-destructive">{flagged.get(field)}</span>
    ) : null;

  if (!verifiedName) {
    return (
      <Card>
        <div className="font-semibold">Your bank account ({payment.destination.country})</div>
        <Notice tone="warn">
          {OWN_ACCOUNT_MESSAGE} We don't have the name from your verified Stables profile yet, so we
          can't add an account. Refresh your verification status above; if it stays like this,
          contact us.
        </Notice>
      </Card>
    );
  }

  if (step === "review") {
    return (
      <PaymentReceipt
        payment={payment}
        mode="summary"
        senderName={verifiedName}
        account={{
          holderName: verifiedName,
          bankName: form.bankName.trim(),
          kind: form.accountKind,
          number: form.account.trim(),
        }}
        footer={
          <div className="space-y-3 border-t border-border/50 pt-4">
            {payment.quote?.expiresAt && <QuoteExpiry expiresAt={payment.quote.expiresAt} />}
            <Notice tone="info">
              {OWN_ACCOUNT_MESSAGE} Check the account number carefully: a payout to a wrong account
              may not be recoverable.
            </Notice>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => create.mutate()}
                disabled={create.isPending}
                className={PRIMARY}
              >
                {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm and create transfer <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setStep("edit")}
                disabled={create.isPending}
                className={SECONDARY}
              >
                Edit details
              </button>
            </div>
            {create.error && <ErrorText error={create.error} />}
          </div>
        }
      />
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.reset();
    setStep("review");
  };

  return (
    <Card>
      <div className="font-semibold">Your bank account ({payment.destination.country})</div>
      <Notice tone="info">{OWN_ACCOUNT_MESSAGE}</Notice>
      <p className="text-sm text-muted-foreground">
        The details go straight to Stables for the payout, which checks them against the rules for
        this country before the transfer is created. LamportPay keeps only the bank name and the
        last four digits.
      </p>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Account holder (your verified name)">
            <input
              value={verifiedName}
              readOnly
              aria-readonly="true"
              className={`${INPUT} bg-secondary/60 text-muted-foreground cursor-not-allowed`}
            />
          </Field>
          <Field label="Bank name">
            <input
              required
              value={form.bankName}
              onChange={(e) => set({ bankName: e.target.value })}
              className={cls("bank_name")}
            />
            {hint("bank_name")}
          </Field>
          <Field label={form.accountKind === "iban" ? "IBAN" : "Account number"}>
            <div className="flex gap-2">
              <select
                value={form.accountKind}
                onChange={(e) =>
                  set({ accountKind: e.target.value as BeneficiaryState["accountKind"] })
                }
                className={`${INPUT} w-auto`}
              >
                <option value="account_number">Account no.</option>
                <option value="iban">IBAN</option>
              </select>
              <input
                required
                value={form.account}
                onChange={(e) => set({ account: e.target.value })}
                className={cls(form.accountKind)}
              />
            </div>
            {hint(form.accountKind)}
          </Field>
          <Field label="Purpose">
            <select
              value={form.purposeCode}
              onChange={(e) => set({ purposeCode: e.target.value as PurposeCode })}
              className={cls("purpose_code")}
            >
              {PURPOSE_CODES.map((code) => (
                <option key={code} value={code}>
                  {code.toLowerCase().replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>
          {showDob && (
            <Field label="Your date of birth (Stables asked for it)">
              <input
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => set({ dateOfBirth: e.target.value })}
                className={cls("date_of_birth")}
              />
              {hint("date_of_birth")}
            </Field>
          )}
        </div>

        {showAddress && (
          <div className="rounded-2xl border border-border/60 p-4">
            <div className="text-sm font-semibold">Your address (Stables asked for it)</div>
            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              <Field label="Street address">
                <input
                  required
                  value={form.street}
                  onChange={(e) => set({ street: e.target.value })}
                  className={cls("address.street")}
                />
                {hint("address.street")}
              </Field>
              <Field label="City">
                <input
                  required
                  value={form.city}
                  onChange={(e) => set({ city: e.target.value })}
                  className={cls("address.city")}
                />
                {hint("address.city")}
              </Field>
              <Field label="State / region">
                <input
                  required
                  value={form.state}
                  onChange={(e) => set({ state: e.target.value })}
                  className={cls("address.state")}
                />
                {hint("address.state")}
              </Field>
              <Field label="Postal code">
                <input
                  required
                  value={form.postalCode}
                  onChange={(e) => set({ postalCode: e.target.value })}
                  className={cls("address.postal_code")}
                />
                {hint("address.postal_code")}
              </Field>
              <Field label="Country (2-letter code)">
                <input
                  required
                  maxLength={2}
                  value={form.addressCountry}
                  onChange={(e) => set({ addressCountry: e.target.value.toUpperCase() })}
                  className={cls("address.country")}
                />
                {hint("address.country")}
              </Field>
            </div>
            {flagged.has("address") && !ADDRESS_FIELDS.some((f) => flagged.has(`address.${f}`)) && (
              <p className="mt-2 text-xs text-destructive">{flagged.get("address")}</p>
            )}
          </div>
        )}

        <details
          open={detailsOpen}
          onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}
          className="rounded-2xl border border-border/60 p-4"
        >
          <summary className="text-sm font-semibold cursor-pointer">
            More bank details (only if your bank uses them)
          </summary>
          <div className="mt-4 grid sm:grid-cols-2 gap-3">
            {BANK_DETAIL_FIELDS.map((field) => (
              <Field key={field} label={DETAIL_LABELS[field]}>
                {field === "account_type" ? (
                  <select
                    value={form.details.account_type ?? ""}
                    onChange={(e) => setDetail("account_type", e.target.value)}
                    className={cls(field)}
                  >
                    <option value="">—</option>
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                    <option value="payment">Payment</option>
                  </select>
                ) : (
                  <input
                    value={form.details[field] ?? ""}
                    onChange={(e) => setDetail(field, e.target.value)}
                    className={cls(field)}
                  />
                )}
                {hint(field)}
              </Field>
            ))}
          </div>
        </details>

        <Notice tone="info">Wise and Revolut accounts are not supported.</Notice>
        <button type="submit" className={PRIMARY}>
          Review payment <ArrowRight className="w-4 h-4" />
        </button>
        {create.error && <ErrorText error={create.error} />}
      </form>
    </Card>
  );
}

function DepositCard({ payment, onFunded }: { payment: PaymentView; onFunded: () => void }) {
  const deposit = payment.deposit!;
  const [signature, setSignature] = useState("");
  const [payer, setPayer] = useState(payment.payerWallet ?? "");
  const verify = useMutation({
    mutationFn: async () => {
      const { status } = await paymentApi(`/api/payments/${payment.id}/funding`, {
        method: "POST",
        body: {
          signature: signature.trim(),
          ...(!payment.payerWallet && payer.trim() && { payer: payer.trim() }),
        },
      });
      if (status === 202) {
        throw new Error("Not finalized on Solana yet. Try again in a few seconds.");
      }
    },
    onSuccess: onFunded,
  });

  const coin = deposit.currency.toUpperCase();
  const issue = payment.depositIssue;
  // With a LamportPay fee, paying happens through the wallet button only: it sends the
  // deposit and the fee in one transaction. No copy-and-send instructions are shown, so
  // the fee can't be left out by accident. Recovery stays possible: a transaction the
  // button prepared can still be verified by its signature.
  const walletOnly = Boolean(payment.platformFee);

  return (
    <Card>
      <div className="font-semibold">Send your {coin}</div>
      {issue ? (
        // Funds reached the deposit address but did not match: sending again
        // would pay twice. Stables decides what happens to what it received.
        <Notice tone="warn">
          We could not accept your deposit: {issue.reason} {issue.received} {coin} reached the
          deposit address ({issue.expected} {coin} was expected).{" "}
          <strong>Do not send again.</strong> Stables decides what happens to the funds it received,
          and this page follows its status.{" "}
          <Link to="/contact" className="underline">
            Contact us
          </Link>{" "}
          with your payment ID.
        </Notice>
      ) : (
        <p className="text-sm text-muted-foreground">
          {walletOnly
            ? `Pay with your wallet below. One transaction sends the exact deposit to a single-use Stables address and the LamportPay fee: ${payment.totalToPay.amount} ${coin} in total. Your wallet shows both transfers before you approve.`
            : `Send exactly this amount of ${coin} on Solana to this single-use deposit address. Use it for this payment only.`}
        </p>
      )}
      {walletOnly ? (
        <div className="grid gap-3">
          <KV k="Deposit amount" v={`${deposit.amount} ${coin}`} />
          <KV k="LamportPay fee" v={`${payment.platformFee!.amount} ${coin}`} />
          <KV k="Total from your wallet" v={`${payment.totalToPay.amount} ${coin}`} />
          <KV k="Network" v={deposit.network === "solana" ? "Solana (mainnet)" : deposit.network} />
        </div>
      ) : (
        <div className="grid gap-3">
          <KV k="Amount" v={<CopyValue value={deposit.amount} suffix={` ${coin}`} />} />
          <KV k="Network" v={deposit.network === "solana" ? "Solana (mainnet)" : deposit.network} />
          <KV k="Deposit address" v={<CopyValue value={deposit.address} mono />} />
        </div>
      )}

      {!issue && (
        <FundingPanelIsland
          paymentId={payment.id}
          amount={deposit.amount}
          currency={coin}
          depositAddress={deposit.address}
          platformFee={payment.platformFee?.amount ?? null}
          onFunded={onFunded}
        />
      )}

      {/* With a fee, only a transaction the wallet button prepared can be verified here. */}
      {(!walletOnly || payment.payerWallet) && (
        <details className="rounded-2xl border border-border/60 p-4">
          <summary className="text-sm font-semibold cursor-pointer">
            {walletOnly ? "Sent it, but this page didn't confirm?" : "Sent it from another wallet?"}
          </summary>
          <p className="mt-3 text-sm text-muted-foreground">
            {walletOnly
              ? "If your wallet sent the payment but this page didn't update, paste the transaction signature from your wallet's activity to confirm it. Don't send again."
              : payment.payerWallet
                ? `The ${coin} must come from the wallet this payment was prepared for. Exchange withdrawals often take a fee from the amount, which would deliver the wrong amount: send from your own wallet instead.`
                : `Enter the wallet you sent from. The ${coin} must come from, and be signed by, that wallet. Exchange withdrawals often take a fee from the amount, which would deliver the wrong amount: send from your own wallet instead.`}
          </p>
          <form
            className="mt-3 grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              verify.mutate();
            }}
          >
            {!walletOnly && (
              <input
                placeholder="Your sending wallet address"
                value={payer}
                disabled={Boolean(payment.payerWallet)}
                onChange={(e) => setPayer(e.target.value)}
                className={`${INPUT} font-mono text-xs`}
              />
            )}
            <input
              placeholder="Transaction signature"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              className={`${INPUT} font-mono text-xs`}
            />
            <button
              type="submit"
              disabled={verify.isPending || !signature.trim() || !payer.trim()}
              className={`${SECONDARY} justify-self-start`}
            >
              {verify.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Verify
            </button>
          </form>
          {verify.error && <ErrorText error={verify.error} />}
        </details>
      )}
    </Card>
  );
}

function Timeline({ payment }: { payment: PaymentView }) {
  // Internal bookkeeping events stay out of the user's timeline.
  const rows = payment.events.filter(
    (e) => e.kind !== "funding_transaction_built" && e.kind !== "platform_fee_mismatch",
  );
  if (rows.length === 0) return null;
  return (
    <Card>
      <div className="font-semibold">Timeline</div>
      <ol className="space-y-2 text-sm">
        {rows.map((e, i) => (
          <li
            key={i}
            className="flex flex-wrap justify-between gap-2 border-b border-border/40 pb-2 last:border-0"
          >
            <span>
              {e.kind === "transition" || e.kind === "payment_created"
                ? (STATUS_LABELS[e.to ?? ""] ?? e.to)
                : (EVENT_LABELS[e.kind] ?? e.kind.replace(/_/g, " "))}
              {e.kind === "transition_rejected" && ` (${e.from} → ${e.to} ignored)`}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(e.at).toLocaleString()} ·{" "}
              {e.source === "webhook" ? "Stables" : "LamportPay"}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ------------------------------------------------------------------- bits

const INPUT = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm";
const PRIMARY =
  "inline-flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 font-semibold hover:opacity-90 transition disabled:opacity-50";
const SECONDARY =
  "inline-flex items-center gap-2 rounded-full bg-card border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition disabled:opacity-50";

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-border/60 bg-card p-6 space-y-4">{children}</div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="rounded-xl bg-secondary/50 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {k}
      </div>
      <div className="text-sm font-semibold mt-0.5 break-all">{v}</div>
    </div>
  );
}

function Notice({ tone, children }: { tone: "info" | "warn"; children: ReactNode }) {
  return (
    <div
      className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${
        tone === "warn"
          ? "border border-destructive/30 bg-destructive/10"
          : "border border-border/60 bg-secondary/60"
      }`}
    >
      <AlertCircle
        className={`w-4 h-4 shrink-0 mt-0.5 ${tone === "warn" ? "text-destructive" : "text-primary"}`}
      />
      <span>{children}</span>
    </div>
  );
}

function ErrorText({ error }: { error: unknown }) {
  const reason = error instanceof PaymentApiError ? error.reason : undefined;
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
      {error instanceof Error ? error.message : "Something went wrong."}
      {reason && (
        <div className="mt-2 rounded-lg bg-background/60 px-3 py-2">
          <span className="font-semibold">Stables says:</span> {reason}
        </div>
      )}
    </div>
  );
}

function CopyValue({
  value,
  suffix = "",
  mono = false,
}: {
  value: string;
  suffix?: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <span className={mono ? "font-mono text-xs" : ""}>
        {value}
        {suffix}
      </span>
      <button
        type="button"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="text-muted-foreground hover:text-foreground"
      >
        {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </span>
  );
}
