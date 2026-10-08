import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { AppLayout, switchToConnectedWallet, useSignedIn } from "@/components/app/AppLayout";
import { walletLinkOf } from "@/lib/identity/wallet-identity";
import { useAccount } from "@/lib/use-account";
import { useModeStatus } from "@/lib/use-mode-status";
import { supabase } from "@/integrations/supabase/client";
import {
  CostSummary,
  DappStepper,
  JourneyStepper,
  StatusTimeline,
} from "@/components/app/PaymentJourney";
import {
  DappWorkspace,
  GlowCard,
  MobileCollapse,
  MobileDock,
  Picker,
  RailCard,
  Skeleton,
  type PickerOption,
} from "@/components/app/DappWorkspace";
import { useScrollToStep } from "@/hooks/use-scroll-to-step";
import { Flag } from "@/components/app/Flag";
import { TokenIcon } from "@/components/app/TokenIcon";
import { PaymentReceipt } from "@/components/site/PaymentReceipt";
import {
  FundingPanelIsland,
  PaymentSwapIsland,
  TestPayIsland,
} from "@/components/site/wallet/WalletIsland";
import { formatMinor, toMajor, toMinor } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PayoutCountry } from "@/lib/payout-countries";
import { requestWalletConnect, requestWalletSignIn, useAppWallet } from "@/lib/wallet-state";
import { chargesFee, splitTotal, type FeeModel } from "@/lib/payments/fee-math";
import { PaymentApiError, paymentApi, type FieldIssue } from "@/lib/payments/api-client";
import type { LiveEstimate } from "@/lib/payments/live-estimate.server";
import type { KycStatus, PaymentView } from "@/lib/payments/view";
import {
  EXTRA_FIELD_UI,
  isBankDetailField,
  normalizeExtra,
  payoutFormFor,
  type ExtraField,
  type PayoutForm,
} from "@/lib/payout-requirements";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "@/lib/tokens";

const OWN_ACCOUNT_MESSAGE = "Payouts can only be sent to a bank account in your own name.";

type Limits = Partial<Record<PaymentCurrency, { min: string; max: string | null } | null>>;

/** "1000000" → "1,000,000". */
function grouped(major: string) {
  const [whole, fraction] = major.split(".");
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}

/**
 * /pay is public: anyone can use the live calculator (Stables + Jupiter) without
 * signing in or connecting a wallet. Starting a conversion needs a LamportPay
 * account (identity verification, own-bank payouts) and a wallet; a payment
 * (?payment=…) is only shown to its signed-in owner.
 */
export const Route = createFileRoute("/pay")({
  ssr: false,
  validateSearch: (
    search: Record<string, unknown>,
  ): { payment?: string; amount?: string; country?: string } => {
    // The router parses "amount=150" as a number; accept both forms.
    const amount =
      typeof search.amount === "number" || typeof search.amount === "string"
        ? String(search.amount)
        : "";
    return {
      ...(typeof search.payment === "string" && { payment: search.payment }),
      ...(/^\d+(\.\d{1,6})?$/.test(amount) && { amount }),
      ...(typeof search.country === "string" &&
        /^[A-Z]{2}$/.test(search.country) && { country: search.country }),
    };
  },
  beforeLoad: async ({ search, location }) => {
    if (!search.payment) return;
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { next: location.href } });
  },
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
  QUOTED: "Quote locked — finish the steps below",
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
  const { payment, amount: initialAmount, country: initialCountry } = Route.useSearch();
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
          platformFeeMin?: string | null;
          platformFeeMax?: string | null;
          payoutCountries?: PayoutCountry[];
        };
      };
    },
  });
  const stablesMode = status.data?.providers.find((p) => p.name === "Stables")?.mode;
  const limits = status.data?.guards?.paymentLimits ?? {};
  const coins = status.data?.guards?.paymentCurrencies ?? [...PAYMENT_CURRENCIES];
  const feeBps = status.data?.guards?.platformFeeBps ?? null;
  const feeMin = status.data?.guards?.platformFeeMin ?? null;
  const feeMax = status.data?.guards?.platformFeeMax ?? null;
  const countries = status.data?.guards?.payoutCountries ?? null;
  // The server's TEST / LIVE mode, shown on every payment/swap screen.
  const mode = useModeStatus();

  const notices = (
    <>
      {stablesMode === "mock" && (
        <Notice tone="warn">
          Payments are unavailable: Stables is not configured on this server.
        </Notice>
      )}
      {mode.indicator.tone === "test" && (
        <Notice tone="info" collapsible>
          <strong>TEST MODE</strong> · no real funds can move. Balances are Solana devnet test
          assets, the payout partner runs in its sandbox, and swaps are priced live but not executed
          (Jupiter runs on mainnet only).
          {limits.usdc?.max &&
            ` Test limit: ${limits.usdc.min}–${limits.usdc.max} USDC per payment.`}{" "}
          Pay Now asks your wallet to sign a devnet test transaction that moves no funds; once it is
          detected, the payout partner&apos;s sandbox simulates the deposit.
        </Notice>
      )}
      {mode.indicator.tone === "live" && (
        <Notice tone="warn">
          <strong>LIVE MODE</strong> · real funds on Solana mainnet with the production payout
          partner. Every signature you approve moves real money.
        </Notice>
      )}
      {mode.indicator.tone === "error" && (
        <Notice tone="warn">
          <strong>{mode.indicator.label}</strong> · {mode.indicator.detail}
        </Notice>
      )}
    </>
  );

  return (
    <AppLayout>
      {payment ? (
        <PaymentPanel paymentId={payment} stablesMode={stablesMode} notices={notices} />
      ) : (
        <ConvertForm
          initialAmount={initialAmount ?? ""}
          initialCountry={initialCountry ?? ""}
          limits={limits}
          coins={coins}
          countries={countries}
          fee={{ bps: feeBps, min: feeMin, max: feeMax }}
          notices={notices}
        />
      )}
    </AppLayout>
  );
}

/** Trust points under the rail (desktop) and under the summary (mobile). */
function TrustList() {
  return (
    <ul className="space-y-2 text-xs text-muted-foreground">
      {[
        "Non-custodial: we never hold your funds",
        "Paid only to your own bank account",
        "You sign every transaction",
      ].map((t) => (
        <li key={t} className="flex items-start gap-2">
          <ShieldCheck className="w-3.5 h-3.5 mt-px text-primary shrink-0" />
          {t}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------- KYC

function KycCard({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [kycEmail, setKycEmail] = useState("");

  const kyc = useQuery({
    queryKey: ["kyc"],
    queryFn: async () => (await paymentApi<KycStatus>("/api/kyc")).data,
  });
  // Wallet sign-in accounts have no email; the payout partner needs one, once.
  const account = useQuery({
    queryKey: ["account-has-email"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return Boolean(data.session?.user.email);
    },
    staleTime: 60_000,
  });
  const needsEmail = account.data === false;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kycEmail.trim());
  const start = useMutation({
    mutationFn: async () =>
      (
        await paymentApi<KycStatus>("/api/kyc", {
          method: "POST",
          body: {
            firstName,
            lastName,
            ...(needsEmail && { email: kycEmail.trim() }),
          },
        })
      ).data,
    onSuccess: (data) => {
      queryClient.setQueryData(["kyc"], data);
      if (data.kycLink) window.open(data.kycLink, "_blank", "noopener");
    },
  });

  const data = kyc.data;
  const approved = data?.status === "approved" && data.basePayout === "approved";

  if (compact && approved) {
    return (
      <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="w-3.5 h-3.5 text-[color:var(--success)]" />
        Identity verified{data.verifiedName ? ` as ${data.verifiedName}` : ""}
      </p>
    );
  }
  if (compact && kyc.isLoading) return null;

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
      {data?.providerUnavailable && (
        <Notice tone="info">
          Our payout partner could not be reached just now, so this is your last known status.
          Refresh in a moment.
        </Notice>
      )}
      {data?.state === "kyc_action_required" && (
        <Notice tone="warn">
          The payout partner needs something more from you. Continue verification to see what.
        </Notice>
      )}

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
                  {needsEmail && (
                    <div className="sm:col-span-2">
                      <Field label="Email (for identity verification)">
                        <input
                          required
                          type="email"
                          autoComplete="email"
                          value={kycEmail}
                          onChange={(e) => setKycEmail(e.target.value)}
                          className={INPUT}
                        />
                      </Field>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Asked once. It goes to our payout partner for your verification.
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => start.mutate()}
                  disabled={
                    start.isPending ||
                    (data.status === "not_started" &&
                      (!firstName.trim() || !lastName.trim() || (needsEmail && !emailValid)))
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

type Preference = "auto" | PaymentCurrency;

type WalletHoldingsView =
  | {
      status: "ok";
      wallet: string;
      readAt: string;
      sol: string;
      tokens: Record<string, string>;
      maxConvertible: Record<string, string>;
      feeBps: number;
      feeMin: string | null;
      feeMax: string | null;
    }
  | { status: "unavailable"; wallet: string; reason: string };

/** `value`, once it has stopped changing for `ms` (for live quotes while typing). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Names for the payout partner's fee components (as its quote reports them). */
const FEE_LABELS: Record<string, string> = {
  total_fee: "Payout partner fee",
  platform_fee: "Partner platform fee",
  payment_method_fee: "Bank payout fee",
  fx_fee: "FX fee",
  integrator_fee: "Integrator fee",
};

/** Minor units of a typed amount, or null while it isn't a valid amount yet. */
function parseAmount(value: string, coin: string): bigint | null {
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  try {
    return toMinor(value, coin);
  } catch {
    return null;
  }
}

const TOKEN_NAMES: Record<string, string> = {
  usdc: "USD Coin",
  usdt: "Tether USD",
  sol: "Solana",
};

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The converter, DEX-style: From (token, amount, balance, Max) → To (country
 * with its payout currency). Visible before a wallet is connected; balances
 * appear once the header's wallet connects. The live quote (partner fee and
 * the amount received) comes from Stables on the next step; nothing here is a
 * provider estimate. Fee arithmetic is the shared fee-math module.
 */
function ConvertForm({
  initialAmount,
  initialCountry,
  limits: allLimits,
  coins,
  countries,
  fee: configuredFee,
  notices,
}: {
  initialAmount: string;
  initialCountry: string;
  limits: Limits;
  /** Payment coins turned on (business settings). */
  coins: PaymentCurrency[];
  /** Countries offered (server configuration); null while loading. */
  countries: PayoutCountry[] | null;
  fee: { bps: number | null; min: string | null; max: string | null };
  notices: ReactNode;
}) {
  const navigate = useNavigate();
  const wallet = useAppWallet();
  const walletKey = wallet.publicKey;
  const account = useAccount();
  const signedIn = account.status === "loading" ? null : account.status === "signed_in";
  const needsSignIn = signedIn === false;
  const queryClient = useQueryClient();
  const differentWallet =
    account.status === "signed_in" &&
    walletLinkOf(walletKey, account.wallets) === "different_wallet";
  const [amount, setAmount] = useState(initialAmount);
  const [preference, setPreference] = useState<Preference>("auto");
  const [country, setCountry] = useState(initialCountry);
  // What the user pays with: the stablecoin itself, or SOL swapped to it by Jupiter.
  const [payWith, setPayWith] = useState<"coin" | "sol">("coin");
  const mode = useModeStatus();
  const testMode = mode.status?.mode === "test";

  const single = coins.length === 1 ? coins[0]! : null;
  const chosen: Preference = single ?? preference;
  const coinKey: PaymentCurrency = chosen === "auto" ? (coins[0] ?? PAYMENT_CURRENCIES[0]) : chosen;
  const limits = allLimits[coinKey] ?? null;
  const coinLabel =
    chosen === "auto" ? coins.map((c) => c.toUpperCase()).join(" or ") : chosen.toUpperCase();

  const destination = countries?.find((c) => c.code === country) ?? null;
  const currency = destination?.currency ?? "";

  const holdings = useQuery({
    queryKey: ["wallet-holdings", walletKey],
    enabled: Boolean(walletKey),
    queryFn: async () =>
      (
        await paymentApi<WalletHoldingsView>("/api/wallet/holdings", {
          method: "POST",
          allowAnonymous: true,
          body: { wallet: walletKey },
        })
      ).data,
  });
  const h = walletKey && holdings.data?.status === "ok" ? holdings.data : null;
  const feeBps = h?.feeBps ?? configuredFee.bps ?? 0;
  const feeModel: FeeModel = {
    bps: BigInt(feeBps),
    minMinor: parseAmount((h ? h.feeMin : configuredFee.min) ?? "", "usdc"),
    maxMinor: parseAmount((h ? h.feeMax : configuredFee.max) ?? "", "usdc"),
  };
  const feeOn = chargesFee(feeModel);

  // Paying in SOL: the amount typed is SOL; Jupiter's read-only quote says how
  // much of the coin it buys, and that is what the user sends.
  const paySol = payWith === "sol";
  const inputAsset: PaymentCurrency | "sol" = paySol ? "sol" : coinKey;
  const typedMinor = parseAmount(amount, inputAsset);
  const solBalanceMinor = h ? parseAmount(h.sol, "sol") : null;
  const holdsSol = solBalanceMinor !== null && solBalanceMinor > 0n;
  // Limits apply to what the user sends in the coin (owner decision 2 Oct 2026);
  // in TEST MODE the server reports its own test limits (1–5,000 USDC).
  const minSend = limits ? parseAmount(limits.min, coinKey) : null;
  const maxSend = limits?.max ? parseAmount(limits.max, coinKey) : null;
  const minSendMajor = minSend !== null ? toMajor(minSend, coinKey) : null;
  const maxSendMajor = maxSend !== null ? toMajor(maxSend, coinKey) : null;

  // Live calculator (no wallet needed): Stables preview quote + LamportPay fee,
  // and the Jupiter side via a read-only quote (mainnet price; Jupiter has no
  // devnet). Refreshes every 30 s.
  const withSol = true;
  const liveAmount = useDebounced(amount, 600);
  const liveMinor = parseAmount(liveAmount, inputAsset);
  const estimate = useQuery({
    queryKey: ["live-estimate", liveAmount, country, currency, coinKey, withSol, inputAsset],
    // Outside the limits the input already says so; no second (server) message.
    // Paying in SOL the coin amount is only known from the quote, so the server checks.
    enabled: Boolean(
      liveMinor &&
      liveMinor > 0n &&
      country &&
      currency &&
      (paySol ||
        ((minSend === null || liveMinor >= minSend) && (maxSend === null || liveMinor <= maxSend))),
    ),
    queryFn: async () =>
      (
        await paymentApi<LiveEstimate>("/api/quote/estimate", {
          method: "POST",
          allowAnonymous: true,
          body: {
            amount: liveAmount,
            country,
            currency,
            coin: coinKey,
            withSol,
            payWith: inputAsset,
          },
        })
      ).data,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const liveMajor = liveMinor !== null ? toMajor(liveMinor, inputAsset) : null;
  const est =
    estimate.data &&
    (paySol
      ? estimate.data.payWith === "sol" && estimate.data.solAmount === liveMajor
      : estimate.data.payWith !== "sol" && estimate.data.amount === liveMajor) &&
    (estimate.data.payout.status !== "priced" || estimate.data.payout.country === country)
      ? estimate.data
      : null;

  // What leaves the wallet in the coin: as typed, or what the SOL buys. LamportPay's
  // fee comes out of it (owner decision 2026-09-30); the rest goes to the payout partner.
  const totalMinor = paySol ? (est ? parseAmount(est.amount, coinKey) : null) : typedMinor;
  const split = totalMinor !== null ? splitTotal(totalMinor, feeModel) : null;
  const amountMinor = split && split.netMinor > 0n ? split.netMinor : null;
  const fee = split ? { minor: split.feeMinor, rule: split.rule } : null;
  const feeMinor = fee?.minor ?? null;
  const balanceMinor = h
    ? paySol
      ? solBalanceMinor
      : parseAmount(h.tokens[coinKey] ?? "0", coinKey)
    : null;
  // "Max" sends the whole stablecoin balance; the fee is taken out of it. Not
  // offered for SOL: some SOL must stay for network fees.
  const maxMajor = h && !paySol ? (h.tokens[coinKey] ?? null) : null;
  const overBalance = typedMinor !== null && balanceMinor !== null && typedMinor > balanceMinor;
  // Over the stablecoin balance is allowed only when a swap could cover it.
  const blocked = paySol ? overBalance : overBalance && !holdsSol;
  const belowMin = !paySol && totalMinor !== null && minSend !== null && totalMinor < minSend;
  const aboveMax = !paySol && totalMinor !== null && maxSend !== null && totalMinor > maxSend;
  const limitText =
    minSendMajor && maxSendMajor
      ? `${grouped(minSendMajor)}–${grouped(maxSendMajor)} ${coinKey.toUpperCase()} per payment`
      : minSendMajor
        ? `Minimum ${grouped(minSendMajor)} ${coinKey.toUpperCase()}`
        : null;

  const create = useMutation({
    mutationFn: async () =>
      (
        await paymentApi<PaymentView>("/api/payments", {
          method: "POST",
          body: {
            // The engine takes the amount for the payout partner; the fee is added back
            // in the same user-signed transaction, so the wallet total is what was entered.
            amount: toMajor(amountMinor ?? 0n, coinKey),
            preferredCurrency: chosen,
            country,
            currency: currency.toLowerCase(),
            ...(walletKey && { wallet: walletKey }),
          },
        })
      ).data,
    onSuccess: (payment) => void navigate({ to: "/pay", search: { payment: payment.id } }),
  });

  const priced = est?.payout.status === "priced" ? est.payout : null;
  const refused = est?.payout.status === "refused" ? est.payout.reason : null;
  // Paying in SOL the coin amount comes from Jupiter, so a live price is required.
  const ready =
    Boolean(amountMinor && amountMinor > 0n && country && currency) && (!paySol || Boolean(priced));
  const updating = estimate.isFetching || (liveAmount !== amount && Boolean(amount));
  // The partner's total, plus its non-zero components for the breakdown.
  const partnerTotal = priced?.partnerFees.find((f) => f.kind === "total_fee") ?? null;
  const partnerParts =
    priced?.partnerFees.filter((f) => f.kind !== "total_fee" && Number(f.amount) !== 0) ?? [];
  // One merged fee for the user: payout partner fees (USD, from its live quote) plus
  // LamportPay's fee (USDC, counted 1:1 as USD). The parts are listed underneath.
  const mergedFee =
    partnerTotal && feeMinor !== null
      ? (Number(partnerTotal.amount) + Number(toMajor(feeMinor, coinKey))).toFixed(2)
      : null;
  // The opening screen stays short: cost details appear once there is something to price.
  const quoteStarted =
    Boolean(destination) &&
    typedMinor !== null &&
    typedMinor > 0n &&
    (Boolean(est) || estimate.isFetching || Boolean(refused));

  const tokenOptions: PickerOption[] = [
    ...coins.map((c) => ({
      value: c,
      label: c.toUpperCase(),
      sublabel: TOKEN_NAMES[c] ?? c,
      icon: <TokenIcon symbol={c} size={28} />,
      right: (
        <span className="text-xs tabular-nums text-muted-foreground">
          {h ? grouped(h.tokens[c] ?? "0") : walletKey ? "…" : ""}
        </span>
      ),
    })),
    {
      // SOL is swapped to the coin by Jupiter. Selectable unless the connected
      // wallet's balance read shows no SOL at all (before a wallet connects the
      // calculator still prices it).
      value: "sol",
      label: "SOL",
      sublabel:
        h && !holdsSol ? "No SOL in this wallet" : `Swapped to ${coinKey.toUpperCase()} by Jupiter`,
      icon: <TokenIcon symbol="sol" size={28} />,
      right: (
        <span className="text-xs tabular-nums text-muted-foreground">
          {h ? grouped(h.sol) : walletKey ? "…" : ""}
        </span>
      ),
      disabled: Boolean(h && !holdsSol),
    },
  ];
  const pickAsset = (value: string) => {
    if (value === "sol") {
      if (!paySol) setAmount("");
      setPayWith("sol");
      return;
    }
    if (paySol) setAmount("");
    setPayWith("coin");
    if (!single) setPreference(value as PaymentCurrency);
  };

  const countryOptions: PickerOption[] = (countries ?? []).map((c) => ({
    value: c.code,
    label: countryName(c.code),
    sublabel: `${c.currency} · ${currencyName(c.currency)}`,
    icon: <Flag code={c.code} size={26} />,
    keywords: [c.code, c.currency],
    right: (
      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
        {c.currency}
      </span>
    ),
  }));

  const signingIn = wallet.signIn.phase === "signing";
  const emailSignInNext = (() => {
    const params = new URLSearchParams();
    if (amount) params.set("amount", amount);
    if (country) params.set("country", country);
    const query = params.toString();
    return `/pay${query ? `?${query}` : ""}`;
  })();

  const submit = () => {
    if (needsSignIn) {
      // Wallet-first: connect (if needed) and sign one message, no funds move.
      // The amount and country stay on the page; email sign-in is the fallback.
      requestWalletSignIn();
      return;
    }
    if (differentWallet) {
      // Never treat another wallet as the signed-in (possibly verified) identity.
      void switchToConnectedWallet(() => queryClient.clear());
      return;
    }
    if (!walletKey) {
      requestWalletConnect();
      return;
    }
    if (!blocked && !aboveMax && !belowMin && ready) create.mutate();
  };

  const ctaLabel = needsSignIn
    ? signingIn
      ? "Check your wallet…"
      : walletKey
        ? "Verify wallet to continue"
        : "Connect wallet to continue"
    : differentWallet
      ? "Sign in with this wallet to continue"
      : !walletKey
        ? "Connect wallet to continue"
        : !typedMinor || typedMinor <= 0n
          ? "Enter an amount"
          : !country
            ? "Choose a destination"
            : blocked
              ? `Not enough ${inputAsset.toUpperCase()}`
              : aboveMax
                ? `Maximum ${grouped(maxSendMajor ?? "0")} ${coinKey.toUpperCase()}`
                : paySol && !priced
                  ? refused
                    ? "Change the amount"
                    : "Getting the live price…"
                  : "Get live quote";

  const ctaDisabled =
    create.isPending ||
    signingIn ||
    (!needsSignIn &&
      !differentWallet &&
      walletKey !== null &&
      (!ready || blocked || belowMin || aboveMax));
  // One primary action, placed per screen size (phone bar, tablet form, xl panel).
  // cn() so the visibility classes win over PRIMARY's inline-flex.
  const ctaButton = (className: string) => (
    <button
      type="button"
      onClick={submit}
      disabled={ctaDisabled}
      className={cn(PRIMARY, className)}
    >
      {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
      {ctaLabel}
      {walletKey && ready && !blocked && !aboveMax && !belowMin && (
        <ArrowRight className="w-4 h-4" />
      )}
    </button>
  );

  const main = (
    <>
      {notices}
      <GlowCard glow>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="p-4 sm:p-6 lg:p-7 space-y-3"
        >
          <div className="flex items-center justify-between gap-3 pb-1">
            <div>
              <h1 className="text-[1.35rem] leading-tight sm:text-2xl font-semibold tracking-tight">
                Convert crypto to <span className="text-uv">your bank account</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                From your own wallet, paid out in local currency.
              </p>
            </div>
            {h && (
              <button
                type="button"
                onClick={() => void holdings.refetch()}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${holdings.isFetching ? "animate-spin" : ""}`} />
                Balances
              </button>
            )}
          </div>

          {/* From */}
          <div className="rounded-2xl border border-border/60 bg-[linear-gradient(180deg,oklch(0.985_0.006_270),oklch(0.97_0.012_275))] p-4 sm:p-5 transition focus-within:border-primary/50 focus-within:shadow-[0_0_0_4px_oklch(0.52_0.22_275/0.08)]">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium uppercase tracking-wider">You convert</span>
              <span className="flex items-center gap-2">
                {!walletKey ? (
                  <button
                    type="button"
                    onClick={requestWalletConnect}
                    className="text-primary hover:underline"
                  >
                    Connect to see balance
                  </button>
                ) : holdings.isLoading ? (
                  <Skeleton className="h-3 w-24" />
                ) : h ? (
                  <>
                    <Wallet className="w-3.5 h-3.5" />
                    {paySol
                      ? `${grouped(h.sol)} SOL`
                      : `${grouped(h.tokens[coinKey] ?? "0")} ${coinKey.toUpperCase()}`}
                    {maxMajor && maxMajor !== "0" && (
                      <button
                        type="button"
                        onClick={() => setAmount(maxMajor)}
                        className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary hover:bg-primary/15 transition"
                      >
                        MAX
                      </button>
                    )}
                  </>
                ) : holdings.data?.status === "unavailable" ? (
                  <span className="text-destructive">Balance unavailable</span>
                ) : null}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <input
                aria-label="Amount to convert"
                inputMode="decimal"
                placeholder={paySol ? "0.0" : (limits?.min ?? "0")}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className="w-full min-w-0 bg-transparent text-4xl sm:text-5xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/40 tabular-nums"
              />
              {single ? (
                <Picker
                  value={paySol ? "sol" : single}
                  options={tokenOptions}
                  onChange={pickAsset}
                  placeholder="Token"
                  heading="Pay with"
                  searchPlaceholder="Search token"
                  emptyText="No token found"
                  footer="USDC is the settlement coin. SOL is swapped to USDC by Jupiter in your own wallet; keep a little SOL for network fees."
                />
              ) : (
                <Picker
                  value={paySol ? "sol" : preference === "auto" ? (coins[0] ?? null) : preference}
                  options={tokenOptions}
                  onChange={pickAsset}
                  placeholder="Token"
                  heading="Pay with"
                  searchPlaceholder="Search token"
                  emptyText="No token found"
                />
              )}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {paySol && est?.sol?.status === "quoted"
                ? `≈ ${grouped(est.amount)} ${coinKey.toUpperCase()} after the swap · `
                : ""}
              {limitText && (paySol ? `Limits apply to the ${coinKey.toUpperCase()}: ` : "")}
              {limitText ?? (minSendMajor ? `Minimum ${grouped(minSendMajor)} ${coinLabel}` : "")}
              {testMode && limitText && (
                <span className="ml-1.5 rounded-full bg-[color:var(--warning)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--warning)]">
                  Test limit
                </span>
              )}
            </div>
            {(overBalance || belowMin || aboveMax) && (
              <p
                className={`mt-2 text-xs ${blocked || belowMin || aboveMax ? "text-destructive" : "text-muted-foreground"}`}
              >
                {belowMin
                  ? `The minimum is ${grouped(minSendMajor ?? "0")} ${coinKey.toUpperCase()}.`
                  : aboveMax
                    ? `The ${testMode ? "TEST MODE " : ""}maximum is ${grouped(maxSendMajor ?? "0")} ${coinKey.toUpperCase()} per payment.`
                    : blocked
                      ? `More than your ${inputAsset.toUpperCase()} balance.${
                          maxMajor ? ` You can send up to ${grouped(maxMajor)}.` : ""
                        }`
                      : `You hold too little ${coinKey.toUpperCase()}; the rest can be swapped from your SOL in your own wallet. The swap's price and cost are shown before you sign.`}
              </p>
            )}
          </div>

          {/* Arrow */}
          <div className="relative flex justify-center -my-5 sm:-my-6 z-10" aria-hidden>
            <span className="grid place-items-center w-10 h-10 sm:w-11 sm:h-11 rounded-2xl border-4 border-card bg-[image:var(--gradient-hero)] text-white shadow-[var(--shadow-elegant)]">
              <ArrowDown className="w-5 h-5" />
            </span>
          </div>

          {/* To */}
          <div className="rounded-2xl border border-border/60 bg-[linear-gradient(180deg,oklch(0.97_0.012_275),oklch(0.985_0.006_270))] p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium uppercase tracking-wider">To your own bank account</span>
              {destination && <span>Payout currency set by country</span>}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                {destination ? (
                  <>
                    <div
                      className={`text-3xl sm:text-4xl font-semibold tracking-tight tabular-nums transition-opacity ${
                        priced ? "text-foreground" : "text-muted-foreground/60"
                      } ${updating ? "opacity-60" : ""}`}
                    >
                      {priced ? (
                        <>
                          {grouped(priced.receives)}{" "}
                          <span className="text-muted-foreground text-2xl">{currency}</span>
                        </>
                      ) : estimate.isLoading ? (
                        <Skeleton className="h-9 w-44" />
                      ) : (
                        currency
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {priced ? (
                        `1 ${coinKey.toUpperCase()} = ${Number(priced.rate.toPrecision(6))} ${currency} · after fees`
                      ) : refused ? (
                        <span className="text-destructive">{refused}</span>
                      ) : (
                        `${currencyName(currency)} · enter an amount for a live quote`
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-lg font-medium text-muted-foreground">
                    Choose where to get paid
                  </div>
                )}
              </div>
              {countries === null ? (
                <Skeleton className="h-10 w-40 rounded-full" />
              ) : (
                <Picker
                  value={country || null}
                  options={countryOptions}
                  onChange={setCountry}
                  placeholder="Select country"
                  heading="Supported destinations"
                  searchPlaceholder="Search country or currency"
                  emptyText="Not available yet"
                  footer="Only destinations our payout partner supports. The live quote confirms each payout."
                />
              )}
            </div>
          </div>

          {/* Tablets; phones use the action bar, lg+ the costs panel beside the converter. */}
          {ctaButton("hidden sm:flex lg:hidden w-full justify-center py-4 text-base mt-2")}
          {needsSignIn && (
            <div className="lg:hidden">
              <EmailSignInHint next={emailSignInNext} />
            </div>
          )}
          {differentWallet && (
            <div className="lg:hidden">
              <DifferentWalletHint />
            </div>
          )}
          {create.error && (
            <div className="lg:hidden">
              <ErrorText error={create.error} />
            </div>
          )}
        </form>
      </GlowCard>
      {signedIn && <KycCard compact />}
    </>
  );

  const aside = (
    <>
      <GlowCard>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Fees &amp; costs</h2>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {est ? (
                <>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${updating ? "bg-[color:var(--warning)]" : "bg-[color:var(--success)] animate-pulse"}`}
                  />
                  {updating
                    ? "Updating…"
                    : `Live · ${new Date(est.checkedAt).toLocaleTimeString()}`}
                </>
              ) : estimate.isFetching ? (
                "Fetching live quote…"
              ) : (
                "Live once you enter amount and country"
              )}
            </span>
          </div>

          {/* You receive — the headline number */}
          <div className="relative overflow-hidden rounded-2xl bg-[image:var(--gradient-hero)] p-px shadow-[0_20px_50px_-24px_oklch(0.52_0.22_275/0.7)]">
            <div className="relative rounded-[15px] bg-card px-5 py-4">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[radial-gradient(circle,oklch(0.82_0.18_200/0.25),transparent_70%)]"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  You receive
                </span>
                {destination && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Flag code={destination.code} size={18} />
                    {countryName(destination.code)}
                  </span>
                )}
              </div>
              <div
                className={`mt-1 flex items-baseline gap-2 tabular-nums transition-opacity ${updating ? "opacity-60" : ""}`}
              >
                {priced ? (
                  <>
                    <span className="text-4xl xl:text-[2.6rem] leading-tight font-bold tracking-tight text-uv">
                      {grouped(priced.receives)}
                    </span>
                    <span className="text-xl font-semibold text-muted-foreground">{currency}</span>
                  </>
                ) : estimate.isLoading ? (
                  <Skeleton className="h-10 w-48 mt-1" />
                ) : (
                  <span className="text-2xl font-semibold text-muted-foreground/60">
                    {currency || "—"}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {priced
                  ? `In your own bank account, after all fees · 1 ${coinKey.toUpperCase()} = ${Number(priced.rate.toPrecision(6))} ${currency}`
                  : belowMin
                    ? `Send at least ${grouped(minSendMajor ?? "0")} ${coinKey.toUpperCase()} for a live quote`
                    : aboveMax
                      ? `Send at most ${grouped(maxSendMajor ?? "0")} ${coinKey.toUpperCase()} for a live quote`
                      : refused
                        ? "Not available for this amount/destination"
                        : "Enter an amount and country for a live quote"}
              </div>
            </div>
          </div>

          {/* Costs: one merged fee line, details underneath. Before an amount and a
              destination there is nothing to price, so the panel stays short. */}
          {!quoteStarted ? (
            <p className="rounded-2xl border border-dashed border-border/70 px-4 py-3 text-xs text-muted-foreground">
              Enter an amount and choose a country: the live rate, the LamportPay fee, the payout
              partner&apos;s fee and the exact amount your bank receives appear here.
            </p>
          ) : (
            <div className="rounded-2xl border border-border/60 bg-background/60 text-sm divide-y divide-border/50">
              <div className="flex justify-between gap-3 px-4 py-2.5">
                <span className="text-muted-foreground">
                  {paySol ? "Leaves your wallet" : "You send"}
                </span>
                <span className="tabular-nums font-medium">
                  {paySol
                    ? typedMinor !== null && typedMinor > 0n
                      ? `${formatMinor(typedMinor, "sol")} SOL`
                      : "—"
                    : totalMinor !== null
                      ? `${formatMinor(totalMinor, coinKey)} ${coinKey.toUpperCase()}`
                      : "—"}
                </span>
              </div>
              <div className="px-4 py-2.5">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">LamportPay + payout partner fees</span>
                  <span className="tabular-nums font-semibold whitespace-nowrap">
                    {mergedFee !== null ? (
                      `−${mergedFee} USD`
                    ) : estimate.isLoading ? (
                      <Skeleton className="h-3.5 w-16" />
                    ) : (
                      <span className="text-muted-foreground font-normal">live quote</span>
                    )}
                  </span>
                </div>
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                  {paySol && totalMinor !== null && (
                    <li className="flex justify-between gap-3">
                      <span>{coinKey.toUpperCase()} from the swap (you send)</span>
                      <span className="tabular-nums">
                        {formatMinor(totalMinor, coinKey)} {coinKey.toUpperCase()}
                      </span>
                    </li>
                  )}
                  <li className="flex justify-between gap-3">
                    <span>LamportPay service fee</span>
                    <span className="tabular-nums">
                      {!feeOn
                        ? "not active yet"
                        : feeMinor !== null
                          ? `${formatMinor(feeMinor, coinKey)} ${coinKey.toUpperCase()}`
                          : "—"}
                    </span>
                  </li>
                  {partnerParts.map((f) => (
                    <li key={f.kind} className="flex justify-between gap-3">
                      <span>{FEE_LABELS[f.kind] ?? f.kind.replace(/_/g, " ")}</span>
                      <span className="tabular-nums">
                        {grouped(f.amount)} {f.currency.toUpperCase()}
                      </span>
                    </li>
                  ))}
                  {amountMinor !== null && (
                    <li className="flex justify-between gap-3">
                      <span>Sent for conversion</span>
                      <span className="tabular-nums">
                        {formatMinor(amountMinor, coinKey)} {coinKey.toUpperCase()}
                      </span>
                    </li>
                  )}
                  {priced && (
                    <li className="flex justify-between gap-3">
                      <span title="The payout partner's quoted rate: what you receive divided by the amount sent for conversion, with its fees already taken out.">
                        Effective rate, after partner fees
                      </span>
                      <span className="tabular-nums">
                        1 {coinKey.toUpperCase()} = {Number(priced.rate.toPrecision(6))} {currency}
                      </span>
                    </li>
                  )}
                </ul>
              </div>
              <div className="px-4 py-2.5">
                <div className="flex justify-between gap-3">
                  <span className={paySol ? "font-medium" : "text-muted-foreground"}>
                    {paySol ? "Jupiter swap" : "Swap (only if paying in SOL)"}
                  </span>
                  <span className="tabular-nums">
                    {est?.sol?.status === "quoted" ? (
                      paySol ? (
                        `${grouped(est.sol.solIn)} SOL → ${grouped(est.sol.coinOut)} ${coinKey.toUpperCase()}`
                      ) : (
                        `≈ ${grouped(Number(est.sol.solIn).toFixed(4))} SOL`
                      )
                    ) : est?.sol?.status === "unavailable" ? (
                      <span className="text-muted-foreground">{est.sol.reason}</span>
                    ) : estimate.isFetching && !est ? (
                      <Skeleton className="h-3.5 w-16" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                </div>
                {est?.sol?.status === "quoted" && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Jupiter fee{" "}
                    {est.sol.jupiterFeeBps !== null
                      ? `${est.sol.jupiterFeeBps / 100}%${est.sol.jupiterFeeMint ? ` (in ${est.sol.jupiterFeeMint.toUpperCase()})` : ""}`
                      : "n/a"}{" "}
                    · price impact{" "}
                    {est.sol.priceImpactPct !== null
                      ? `${(Math.abs(est.sol.priceImpactPct) * 100).toFixed(3)}%`
                      : "n/a"}
                    {est.sol.routeLabels.length > 0 && ` · via ${est.sol.routeLabels.join(", ")}`}
                    {testMode && (
                      <div className="mt-0.5">
                        Live mainnet price (read-only). Jupiter has no devnet, so TEST MODE can't
                        run the swap itself.
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="px-4 py-2 text-[11px] text-muted-foreground">
                Solana network fee: a tiny amount of SOL, shown when you sign.
              </div>
            </div>
          )}
          {refused && <Notice tone="warn">{refused}</Notice>}
          {estimate.error && <ErrorText error={estimate.error} />}
          {paySol && testMode && (
            <Notice tone="info">
              TEST MODE: the swap price above is live, but the swap itself can't run here (Jupiter
              has no devnet). Your payment continues in test USDC and no SOL is spent.
            </Notice>
          )}
          {ctaButton("hidden lg:flex w-full justify-center py-3.5 text-base")}
          {needsSignIn && (
            <div className="hidden lg:block">
              <EmailSignInHint next={emailSignInNext} />
            </div>
          )}
          {differentWallet && (
            <div className="hidden lg:block">
              <DifferentWalletHint />
            </div>
          )}
          {create.error && (
            <div className="hidden lg:block">
              <ErrorText error={create.error} />
            </div>
          )}
        </div>
      </GlowCard>
      <div className="px-1">
        <TrustList />
      </div>
      <MobileDock className="sm:hidden">
        <div className="mb-2 flex items-baseline justify-between gap-3 text-xs">
          <span className="text-muted-foreground">You receive</span>
          <span
            className={`tabular-nums truncate transition-opacity ${updating ? "opacity-60" : ""}`}
          >
            {priced ? (
              <>
                <span className="text-base font-bold text-uv">{grouped(priced.receives)}</span>{" "}
                <span className="font-semibold text-muted-foreground">{currency}</span>
              </>
            ) : estimate.isFetching ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <span className="text-muted-foreground">
                {destination ? "Enter an amount" : "Choose a country"}
              </span>
            )}
          </span>
        </div>
        {ctaButton("flex w-full justify-center py-3.5 text-base")}
      </MobileDock>
    </>
  );

  return <DappWorkspace main={main} aside={aside} />;
}

function CostRow({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="px-4 py-2.5 flex items-center justify-between gap-3">
      <span className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums text-right ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

// ----------------------------------------------------------------- payment

function PaymentPanel({
  paymentId,
  stablesMode,
  notices,
}: {
  paymentId: string;
  stablesMode?: string;
  notices: ReactNode;
}) {
  const queryClient = useQueryClient();
  const key = ["payment", paymentId];
  const payment = useQuery({
    queryKey: key,
    queryFn: async () => (await paymentApi<PaymentView>(`/api/payments/${paymentId}`)).data,
    refetchInterval: (query) => (query.state.data?.terminal ? false : 5000),
    // Keep following Stables while the user is in their wallet or another tab;
    // each poll lets the server re-read the transfer from Stables (throttled).
    refetchIntervalInBackground: true,
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

  const mode = useModeStatus();
  const testMode = mode.status?.mode === "test";
  const p = payment.data;

  // The quote comes first (owner flow, 3 Oct 2026): price a new payment at once,
  // before verification. Once per page load; "Refresh quote" re-prices later.
  const autoQuoted = useRef(false);
  const unquoted = p
    ? ["PAYMENT_CREATED", "KYC_PENDING", "KYC_APPROVED"].includes(p.status)
    : false;
  useEffect(() => {
    if (!unquoted || autoQuoted.current) return;
    autoQuoted.current = true;
    quote.mutate();
  }, [unquoted, quote]);

  // When the payment moves on (transfer created, payment detected, completed,
  // wallet check), bring the new action into view instead of leaving it below.
  const actionRef = useRef<HTMLDivElement>(null);
  useScrollToStep(
    p ? `${p.status}|${p.testPayment ? 1 : 0}|${p.travelRule?.status ?? ""}` : "",
    actionRef,
  );

  // No payment yet: only an actual error is shown as one. A query that is still
  // pending (including one paused while the browser is offline, e.g. right
  // after the computer wakes from sleep) keeps the skeleton; it used to fall
  // through to "Payment not found." (3 Oct 2026).
  if (!p) {
    const waiting = !payment.isError;
    return (
      <DappWorkspace
        rail={
          <RailCard>
            <DappStepper current={2} />
          </RailCard>
        }
        main={
          <GlowCard>
            <div className="p-6 space-y-4">
              {waiting ? (
                <>
                  {payment.fetchStatus === "paused" && (
                    <p className="text-sm text-muted-foreground">
                      Waiting for your connection to load this payment…
                    </p>
                  )}
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-72" />
                  <Skeleton className="h-24 w-full rounded-2xl" />
                </>
              ) : (
                <ErrorText error={payment.error} />
              )}
            </div>
          </GlowCard>
        }
      />
    );
  }

  const preTransfer = ["PAYMENT_CREATED", "KYC_PENDING", "KYC_APPROVED", "QUOTED"].includes(
    p.status,
  );
  const walletCheck = p.travelRule?.status === "required" || p.travelRule?.status === "expired";
  // TEST MODE: the devnet payment was detected; Stables (sandbox) now processes.
  const detected = Boolean(p.testPayment) && FUNDABLE.has(p.status);

  const quoteExpired =
    p.status === "QUOTED" &&
    Boolean(p.quote?.expiresAt) &&
    Date.parse(p.quote!.expiresAt!) <= Date.now();

  // What has happened: secondary while the user is still setting up the payment
  // (folded in the side panel), the main news once the transfer exists.
  const history = (
    <MobileCollapse
      title="What has happened"
      summary={STATUS_LABELS[p.status] ?? p.status}
      enabled={preTransfer}
    >
      <Card>
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">What has happened</div>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--success)] animate-pulse" />
            Updates automatically
          </span>
        </div>
        <StatusTimeline payment={p} />
        {preTransfer ? (
          <details className="group text-sm">
            <summary className="cursor-pointer text-xs font-medium text-primary hover:underline">
              Show event log
            </summary>
            <div className="mt-2">
              <Timeline payment={p} />
            </div>
          </details>
        ) : (
          <Timeline payment={p} />
        )}
      </Card>
    </MobileCollapse>
  );

  const rail = (
    <RailCard
      footer={
        <div className="space-y-4">
          <TrustList />
          <Link
            to="/pay"
            search={{}}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Start another conversion <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      }
    >
      <JourneyStepper payment={p} />
    </RailCard>
  );

  const main = (
    <>
      {notices}
      <GlowCard glow>
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="relative flex items-center">
                <TokenIcon symbol={p.source.currency} size={36} />
                <span className="-ml-2 rounded-md ring-2 ring-card">
                  <Flag code={p.destination.country} size={28} />
                </span>
              </span>
              <div>
                <div className="font-semibold">
                  {p.source.currency.toUpperCase()} → {p.destination.currency.toUpperCase()}
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    · {countryName(p.destination.country)}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">Payment {p.id}</div>
                {preTransfer && (
                  <Link
                    to="/pay"
                    search={{
                      amount: p.totalToPay.amount,
                      country: p.destination.country.toUpperCase(),
                    }}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <ArrowLeft className="w-3 h-3" /> Change amount or country
                  </Link>
                )}
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full ${
                walletCheck
                  ? "bg-[color:var(--warning)]/20 text-foreground"
                  : p.status === "COMPLETED"
                    ? "bg-[color:var(--success)]/15 text-[color:var(--success)]"
                    : p.terminal
                      ? "bg-destructive/10 text-destructive"
                      : "bg-primary/10 text-primary"
              }`}
            >
              {!p.terminal && !walletCheck && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              )}
              {walletCheck
                ? "Action needed — verify your wallet"
                : detected
                  ? "Payment detected — processing"
                  : (STATUS_LABELS[p.status] ?? p.status)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary/50 p-3 sm:p-4">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                You send
              </div>
              <div className="mt-0.5 truncate text-lg font-semibold tabular-nums">
                {money(p.totalToPay.amountMinor, p.totalToPay.currency)}
              </div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {p.actualPayout ? "You received" : "You receive"}
              </div>
              <div
                className={`mt-0.5 truncate text-lg font-bold tabular-nums ${quoteExpired ? "text-muted-foreground line-through" : "text-uv"}`}
              >
                {p.actualPayout
                  ? money(p.actualPayout.amountMinor, p.actualPayout.currency)
                  : money(p.destination.amountMinor, p.destination.currency)}
              </div>
              {quoteExpired && (
                <div className="text-[11px] text-destructive">
                  Quote expired · refresh for today&apos;s rate
                </div>
              )}
            </div>
          </div>

          {p.failureReason && <Notice tone="warn">{p.failureReason}</Notice>}
          {p.payoutEstimateMinutes !== null && !walletCheck && !preTransfer && (
            <Notice tone="info">
              Usually reaches your bank within about{" "}
              {p.payoutEstimateMinutes >= 60 && p.payoutEstimateMinutes % 60 === 0
                ? `${p.payoutEstimateMinutes / 60} hour${p.payoutEstimateMinutes === 60 ? "" : "s"}`
                : `${p.payoutEstimateMinutes} minutes`}
              . This is an estimate; each step's actual time appears in the timeline.
            </Notice>
          )}

          {preTransfer && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => quote.mutate()}
                disabled={quote.isPending}
                className={p.status === "QUOTED" ? SECONDARY : PRIMARY}
              >
                {quote.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {p.status === "QUOTED" ? "Refresh quote" : "Get live quote"}
              </button>
              {p.status === "QUOTED" && p.quote?.expiresAt && (
                <QuoteExpiry expiresAt={p.quote.expiresAt} />
              )}
            </div>
          )}
          {quote.error && <ErrorText error={quote.error} />}
        </div>
      </GlowCard>

      {/* The wallet only takes the main column when it needs the user (swap,
          top-up, connect); when it is ready it is a compact card in the side panel. */}
      {preTransfer && p.settlement && p.settlement.kind !== "funds_ready" && (
        <SettlementCard payment={p} stablesMode={stablesMode} onChanged={setPayment} />
      )}
      <div ref={actionRef} />
      {walletCheck && <TravelRuleCard payment={p} onCheck={() => void payment.refetch()} />}
      {p.status === "QUOTED" && (
        <CheckoutFlow
          payment={p}
          kyc={kyc.data}
          testMode={testMode}
          onRefreshQuote={() => quote.mutate()}
          refreshingQuote={quote.isPending}
          onChanged={setPayment}
        />
      )}
      {/* TEST MODE: the transfer exists but the payment wasn't made yet (e.g. a
          rejected wallet approval or a reload): Pay Now again, same payment. */}
      {testMode && p.transferId && FUNDABLE.has(p.status) && !p.testPayment && (
        <Card>
          <div className="font-semibold">Pay now</div>
          <p className="text-sm text-muted-foreground">
            Your transfer is ready. Approve the payment in your wallet to continue.
          </p>
          <MobileDock>
            <TestPayIsland
              paymentId={p.id}
              expectedWallet={p.settlement?.wallet ?? null}
              autoStart={queryClient.getQueryData<boolean>(["autopay", p.id]) === true}
              onAutoStarted={() => queryClient.removeQueries({ queryKey: ["autopay", p.id] })}
              label={`Pay now · ${p.totalToPay.amount} ${p.totalToPay.currency.toUpperCase()}`}
              onPaid={setPayment}
            />
          </MobileDock>
        </Card>
      )}
      {p.testPayment && (
        <Card>
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-5 h-5 text-[color:var(--success)]" />
            Payment detected on Solana devnet
            <span className="rounded-full bg-[color:var(--warning)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--warning)]">
              Devnet · partner sandbox
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            TEST MODE: your wallet signed a devnet transaction for this payment (no funds moved),
            and the payout partner's sandbox received the simulated deposit. The status above
            follows the payout partner.
          </p>
          <a
            href={p.testPayment.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            View transaction <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </Card>
      )}
      {!testMode && p.deposit && FUNDABLE.has(p.status) && !p.funding && (
        <DepositCard payment={p} onFunded={() => void payment.refetch()} />
      )}
      {p.status === "COMPLETED" && (
        <div className="rounded-3xl p-px bg-[image:var(--gradient-hero)] shadow-[var(--shadow-elegant)]">
          <div className="rounded-[23px] bg-card p-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid place-items-center w-10 h-10 rounded-full bg-[color:var(--success)]/15">
                <CheckCircle2 className="w-6 h-6 text-[color:var(--success)]" />
              </span>
              <div>
                <div className="font-semibold">Paid into your bank account</div>
                <div className="text-xs text-muted-foreground">
                  Your receipt has the amounts, fees and on-chain links.
                </div>
              </div>
            </div>
            <MobileDock>
              <Link to="/payments/$id" params={{ id: p.id }} className={PRIMARY}>
                View receipt <ArrowRight className="w-4 h-4" />
              </Link>
            </MobileDock>
          </div>
        </div>
      )}
      {!preTransfer && history}
    </>
  );

  const aside = (
    <>
      <MobileCollapse
        title="Fees & costs"
        summary={`LamportPay fee ${p.platformFee ? money(p.platformFee.amountMinor, p.platformFee.currency) : "—"} · rate ${p.exchangeRate !== null ? `1 ${p.source.currency.toUpperCase()} = ${Number(p.exchangeRate.toPrecision(6))} ${p.destination.currency.toUpperCase()}` : "—"}`}
      >
        <GlowCard>
          <div className="p-4 sm:p-5 space-y-3">
            <h2 className="text-sm font-semibold">Fees &amp; costs</h2>
            <CostSummary payment={p} />
            {preTransfer && p.payoutEstimateMinutes !== null && (
              <p className="text-[11px] text-muted-foreground">
                Usually reaches your bank within about{" "}
                {p.payoutEstimateMinutes >= 60 && p.payoutEstimateMinutes % 60 === 0
                  ? `${p.payoutEstimateMinutes / 60} hour${p.payoutEstimateMinutes === 60 ? "" : "s"}`
                  : `${p.payoutEstimateMinutes} minutes`}{" "}
                (estimate).
              </p>
            )}
          </div>
        </GlowCard>
      </MobileCollapse>
      {preTransfer && p.settlement?.kind === "funds_ready" && (
        <MobileCollapse
          title={`Wallet · paying with ${(p.settlement.coin ?? p.source.currency).toUpperCase()}`}
          summary={`${SETTLEMENT_TITLES.funds_ready} · ${p.settlement.reason}`}
        >
          <SettlementCard payment={p} stablesMode={stablesMode} onChanged={setPayment} compact />
        </MobileCollapse>
      )}
      {preTransfer && history}
    </>
  );

  return <DappWorkspace rail={rail} main={main} aside={aside} />;
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
  compact = false,
}: {
  payment: PaymentView;
  stablesMode?: string;
  onChanged: (p: PaymentView) => void;
  /** Side-panel version for a wallet that is ready: balance, status, re-check. */
  compact?: boolean;
}) {
  const s = payment.settlement!;
  const walletKey = useAppWallet().publicKey;
  const coin = (s.coin ?? payment.source.currency).toUpperCase();
  const canChange =
    ["PAYMENT_CREATED", "KYC_PENDING", "KYC_APPROVED"].includes(payment.status) &&
    !payment.quote &&
    !payment.latestSwap;
  // After the (automatic) quote the coin is fixed, but the balance can still be
  // re-read, e.g. after topping up the wallet (3 Oct 2026).
  const canRecheck = canChange || (payment.status === "QUOTED" && !payment.latestSwap);
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
  // Once the coin is fixed only its own answer matters; the other coin's row
  // (e.g. "USDT with Stables") would read as a second, stale way to pay.
  const candidates = canChange
    ? s.candidates
    : s.candidates.filter((c) => c.coin.toUpperCase() === coin);

  if (compact) {
    const held = s.holdings?.status === "ok" ? s.holdings.tokens[coin.toLowerCase()] : undefined;
    return (
      <GlowCard>
        <div className="p-4 sm:p-5 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Wallet</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--success)]/15 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--success)]">
              <CheckCircle2 className="w-3 h-3" /> {SETTLEMENT_TITLES[s.kind] ?? s.kind}
            </span>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/60 divide-y divide-border/50">
            <CostRow label="Address" value={s.wallet ? shortAddress(s.wallet) : "Not connected"} />
            <CostRow
              label={`${coin} balance`}
              value={held !== undefined ? `${held} ${coin}` : "—"}
            />
            {s.holdings?.status === "ok" && (
              <CostRow label="SOL for network fees" value={`${s.holdings.sol} SOL`} />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {s.reason} No swap needed: you pay in {coin} directly. Checked{" "}
            {new Date(s.checkedAt).toLocaleTimeString()}.
          </p>
          {canRecheck && (
            <button
              type="button"
              onClick={() => (walletKey ? recheck.mutate() : requestWalletConnect())}
              disabled={recheck.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-60"
            >
              {recheck.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Check my wallet again
            </button>
          )}
          {recheck.error && <ErrorText error={recheck.error} />}
        </div>
      </GlowCard>
    );
  }

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
        {candidates.map((c) => (
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

      {canRecheck && (
        <div className="space-y-3">
          {!walletKey && (
            <p className="text-sm text-muted-foreground">
              Connect your wallet in the header so we can read its balances.
            </p>
          )}
          <button
            type="button"
            onClick={() => (walletKey ? recheck.mutate() : requestWalletConnect())}
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
    <div className="rounded-3xl border-2 border-[color:var(--warning)] bg-card p-4 sm:p-6 space-y-4">
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
          <MobileDock className="flex flex-wrap items-center gap-3 max-sm:gap-2">
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
          </MobileDock>
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
  firstName: string;
  lastName: string;
  email: string;
  bankName: string;
  account: string;
  extra: Partial<Record<ExtraField, string>>;
  street: string;
  city: string;
  state: string;
  postalCode: string;
};

/** What the transfer API takes as the user's own bank account. */
type BeneficiaryBody = {
  bankName: string;
  accountNumber: string;
  address?: { street: string; city: string; state: string; postalCode: string; country: string };
  details?: Record<string, string>;
};

/** Payout details Stables accepted (checked server-side), kept in memory only. */
type CheckedDetails = {
  beneficiary: BeneficiaryBody;
  holderName: string;
  holderSource: "verified_record" | "entered";
};

const CHECKED_KEY = (paymentId: string) => `lamportpay:payout-details:${paymentId}`;

function readCheckedDetails(paymentId: string): CheckedDetails | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(CHECKED_KEY(paymentId));
    if (!raw) return null;
    const value = JSON.parse(raw) as CheckedDetails;
    return value?.beneficiary?.accountNumber ? value : null;
  } catch {
    return null;
  }
}

function writeCheckedDetails(paymentId: string, value: CheckedDetails | null) {
  try {
    if (value) window.sessionStorage.setItem(CHECKED_KEY(paymentId), JSON.stringify(value));
    else window.sessionStorage.removeItem(CHECKED_KEY(paymentId));
  } catch {
    // Storage unavailable: the details are simply asked again after a reload.
  }
}

const ADDRESS_FIELDS = ["street", "city", "state", "postal_code"] as const;

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

/** The corridor's fields, plus any further one Stables flagged (its rules can change). */
function extraFields(corridor: PayoutForm | null, flagged: Map<string, string>): ExtraField[] {
  const fields: ExtraField[] = [...(corridor?.extra ?? [])];
  for (const key of flagged.keys()) {
    const field = (key.startsWith("address") ? "address" : key) as ExtraField;
    if ((field === "address" || field in EXTRA_FIELD_UI) && !fields.includes(field)) {
      fields.push(field);
    }
  }
  return fields;
}

/**
 * After the quote: (1) personal + payout details in one step, checked with
 * Stables; (2) the verification gate, decided by the server's KYC state;
 * (3) review and Pay Now, unlocked only for a verified customer with a valid
 * quote. A returning verified customer skips straight past (2).
 */
function CheckoutFlow({
  payment,
  kyc,
  testMode,
  onRefreshQuote,
  refreshingQuote,
  onChanged,
}: {
  payment: PaymentView;
  kyc: KycStatus | undefined;
  testMode: boolean;
  onRefreshQuote: () => void;
  refreshingQuote: boolean;
  onChanged: (p: PaymentView) => void;
}) {
  const queryClient = useQueryClient();
  // Kept for this payment in this browser tab only (sessionStorage), so returning
  // from Stables' verification page — which reloads /pay — does not ask for the
  // bank details again. Cleared once the transfer exists or on "Edit".
  const [checked, setCheckedState] = useState<CheckedDetails | null>(() =>
    readCheckedDetails(payment.id),
  );
  const setChecked = (value: CheckedDetails | null) => {
    setCheckedState(value);
    writeCheckedDetails(payment.id, value);
  };
  const verified = kyc?.state === "kyc_verified";

  // Poll the server's verification record while it is open (Stables reviews async).
  useQuery({
    queryKey: ["kyc", "poll"],
    enabled: Boolean(checked) && !verified && kyc?.state !== "kyc_rejected",
    refetchInterval: 8000,
    queryFn: async () => {
      const data = (await paymentApi<KycStatus>("/api/kyc")).data;
      queryClient.setQueryData(["kyc"], data);
      return data;
    },
  });

  const createTransfer = async () => {
    if (!checked) throw new Error("Add your payout details first.");
    const view = (
      await paymentApi<PaymentView>(`/api/payments/${payment.id}/transfer`, {
        method: "POST",
        body: { purposeCode: "TRANSFER_TO_OWN_ACCOUNT", beneficiary: checked.beneficiary },
      })
    ).data;
    writeCheckedDetails(payment.id, null);
    // The screen switches to the "transfer ready" card once the transfer exists;
    // tell it to continue straight to the wallet approval (one Pay Now click).
    queryClient.setQueryData(["autopay", payment.id], true);
    onChanged(view);
  };
  const liveTransfer = useMutation({ mutationFn: createTransfer });

  // details → verify → review: after each step completes, the next one comes into view.
  const stage = !checked ? "details" : !verified ? "verify" : "review";
  const stageRef = useRef<HTMLDivElement>(null);
  useScrollToStep(stage, stageRef);

  const quoteValid =
    payment.quote?.expiresAt !== null &&
    payment.quote?.expiresAt !== undefined &&
    Date.parse(payment.quote.expiresAt) - 15_000 > Date.now();
  // Pay Now only once the wallet holds what this payment needs (a needed swap
  // done first). TEST MODE cannot run swaps, so it needs devnet USDC instead.
  const fundsReady = payment.settlement?.kind === "funds_ready";
  const canPay = Boolean(checked) && verified && quoteValid && fundsReady;

  return (
    <>
      {stage === "details" && <div ref={stageRef} />}
      <PayoutDetailsStep
        payment={payment}
        kyc={kyc}
        checked={checked}
        onChecked={setChecked}
        onEdit={() => setChecked(null)}
      />
      {stage !== "details" && <div ref={stageRef} />}
      {checked && !verified && <VerificationGate kyc={kyc} />}
      {checked && verified && (
        <PaymentReceipt
          payment={payment}
          mode="summary"
          senderName={kyc?.verifiedName ?? checked.holderName}
          account={{
            holderName: kyc?.verifiedName ?? checked.holderName,
            bankName: checked.beneficiary.bankName,
            kind: "account_number",
            number: checked.beneficiary.accountNumber,
          }}
          footer={
            // Two siblings, both direct children of the summary card: the notes, then
            // the quote timer + Pay Now strip, which stays on screen (sticky) on tablets
            // and desktop while the summary above is read. Phones dock it instead.
            <>
              <div className="space-y-3 border-t border-border/50 pt-4">
                {!quoteValid && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Notice tone="warn">The quote expired. Refresh it to see today's rate.</Notice>
                    <button
                      type="button"
                      onClick={onRefreshQuote}
                      disabled={refreshingQuote}
                      className={SECONDARY}
                    >
                      {refreshingQuote && <Loader2 className="w-4 h-4 animate-spin" />}
                      Refresh quote
                    </button>
                  </div>
                )}
                <Notice tone="info">
                  {OWN_ACCOUNT_MESSAGE} Check the account number: a payout to a wrong account may
                  not be recoverable.
                </Notice>
                {!fundsReady && (
                  <Notice tone="warn">
                    {payment.settlement?.reason ?? "Your wallet balance hasn't been checked yet."}{" "}
                    {testMode
                      ? "In TEST MODE swaps can't run: add devnet test USDC to this wallet (Circle faucet), then use “Check my wallet again”."
                      : "Complete the step above first; Pay Now unlocks when your wallet holds the full amount."}
                  </Notice>
                )}
              </div>
              <div className="sm:sticky sm:bottom-4 sm:z-20 sm:-mx-2 sm:rounded-2xl sm:border sm:border-border/60 sm:bg-card/95 sm:p-3 sm:shadow-[var(--shadow-elegant)] sm:backdrop-blur-xl space-y-2">
                {payment.quote?.expiresAt && <QuoteExpiry expiresAt={payment.quote.expiresAt} />}
                {testMode ? (
                  <MobileDock>
                    <TestPayIsland
                      paymentId={payment.id}
                      prepare={createTransfer}
                      disabled={!canPay}
                      expectedWallet={payment.settlement?.wallet ?? null}
                      label={`Pay now · ${payment.totalToPay.amount} ${payment.totalToPay.currency.toUpperCase()}`}
                      onPaid={onChanged}
                    />
                  </MobileDock>
                ) : (
                  <MobileDock className="space-y-3 max-sm:space-y-2">
                    <button
                      type="button"
                      disabled={!canPay || liveTransfer.isPending}
                      onClick={() => liveTransfer.mutate()}
                      className={`${PRIMARY} w-full justify-center py-3.5 text-base`}
                    >
                      {liveTransfer.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                      Pay now · {payment.totalToPay.amount}{" "}
                      {payment.totalToPay.currency.toUpperCase()}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      Next, your wallet asks you to approve the payment. Nothing moves until you
                      approve.
                    </p>
                    {liveTransfer.error && <ErrorText error={liveTransfer.error} />}
                  </MobileDock>
                )}
              </div>
            </>
          }
        />
      )}
    </>
  );
}

/** One step for personal + payout details; only what Stables needs for this currency. */
function PayoutDetailsStep({
  payment,
  kyc,
  checked,
  onChecked,
  onEdit,
}: {
  payment: PaymentView;
  kyc: KycStatus | undefined;
  checked: CheckedDetails | null;
  onChecked: (c: CheckedDetails) => void;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const currency = payment.destination.currency.toUpperCase();
  const corridor = payoutFormFor(currency);
  const verifiedName = kyc?.state === "kyc_verified" ? kyc.verifiedName : null;
  const registered = kyc ? kyc.state !== "not_registered" : false;
  // Wallet sign-in accounts have no email; Stables needs one, once, for KYC.
  const account = useQuery({
    queryKey: ["account-has-email"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return Boolean(data.session?.user.email);
    },
    staleTime: 60_000,
  });
  const needsEmail = !registered && account.data === false;
  const [form, setForm] = useState<BeneficiaryState>({
    firstName: "",
    lastName: "",
    email: "",
    bankName: "",
    account: "",
    extra: {},
    street: "",
    city: "",
    state: "",
    postalCode: "",
  });
  const set = (patch: Partial<BeneficiaryState>) => setForm((f) => ({ ...f, ...patch }));
  const setExtra = (field: ExtraField, value: string) =>
    setForm((f) => ({ ...f, extra: { ...f.extra, [field]: value } }));

  const check = useMutation({
    mutationFn: async (fields: ExtraField[]) => {
      const details = Object.fromEntries(
        fields
          .filter(isBankDetailField)
          .map((f) => [f, normalizeExtra(f, form.extra[f] ?? "")] as const)
          .filter(([, v]) => v),
      );
      const beneficiary: BeneficiaryBody = {
        bankName: form.bankName.trim(),
        accountNumber: form.account.replace(/\s/g, ""),
        ...(fields.includes("address") && {
          address: {
            street: form.street.trim(),
            city: form.city.trim(),
            state: form.state.trim(),
            postalCode: form.postalCode.trim(),
            country: payment.destination.country,
          },
        }),
        ...(Object.keys(details).length > 0 && { details }),
      };
      const enteredName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
      const result = (
        await paymentApi<{ holderName: string; holderSource: CheckedDetails["holderSource"] }>(
          `/api/payments/${payment.id}/payout-details`,
          {
            method: "POST",
            body: { beneficiary, ...(!verifiedName && { holderName: enteredName }) },
          },
        )
      ).data;
      // New customer: register with Stables now (name + email only; documents
      // are collected on Stables' own page). Never "verified" by this call.
      if (!registered) {
        const status = (
          await paymentApi<KycStatus>("/api/kyc", {
            method: "POST",
            body: {
              firstName: form.firstName.trim(),
              lastName: form.lastName.trim(),
              ...(needsEmail && { email: form.email.trim() }),
            },
          })
        ).data;
        queryClient.setQueryData(["kyc"], status);
      }
      return { beneficiary, ...result };
    },
    onSuccess: onChecked,
  });

  const flagged = useMemo(() => flaggedFields(check.error), [check.error]);
  const fields = extraFields(corridor, flagged);
  const cls = (field: string) =>
    flagged.has(field) ? `${INPUT} border-destructive ring-1 ring-destructive/40` : INPUT;
  const hint = (field: string, help?: string) =>
    flagged.has(field) ? (
      <span className="block mt-1 text-xs text-destructive">{flagged.get(field)}</span>
    ) : help ? (
      <span className="block mt-1 text-xs text-muted-foreground">{help}</span>
    ) : null;

  if (!corridor) {
    return (
      <Card>
        <div className="font-semibold">Your payout details</div>
        <Notice tone="warn">
          Payouts in {currency} need documents our payout partner collects separately, so they
          aren't available in LamportPay yet.
        </Notice>
      </Card>
    );
  }
  if (kyc?.state === "kyc_rejected") {
    return (
      <Card>
        <div className="font-semibold">Your payout details</div>
        <Notice tone="warn">
          Identity verification was rejected by our payout partner, so payouts are not possible.
          Contact support if you think this is a mistake.
        </Notice>
      </Card>
    );
  }

  if (checked) {
    return (
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-5 h-5 text-[color:var(--success)]" />
            Payout details checked
          </div>
          <button type="button" onClick={onEdit} className="text-sm text-primary hover:underline">
            Edit
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          {(kyc?.state === "kyc_verified" && kyc.verifiedName) || checked.holderName} ·{" "}
          {checked.beneficiary.bankName} · ••••
          {checked.beneficiary.accountNumber.slice(-4)} · {countryName(payment.destination.country)}
        </p>
        {kyc?.state === "kyc_verified" && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-[color:var(--success)]" />
            Identity verified{kyc.verifiedName ? ` as ${kyc.verifiedName}` : ""}
          </p>
        )}
      </Card>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    check.mutate(fields);
  };

  return (
    <Card>
      <div className="font-semibold">Your details for the payout</div>
      <p className="text-sm text-muted-foreground">
        These details are required so your payout can be sent to your own bank account in{" "}
        {countryName(payment.destination.country)}. Only what our payout partner needs for{" "}
        {currency} is asked. LamportPay keeps just the bank name and the last four digits.
      </p>
      <form id={`payout-details-${payment.id}`} className="space-y-4" onSubmit={submit}>
        <div className="grid sm:grid-cols-2 gap-3">
          {verifiedName ? (
            <div className="sm:col-span-2">
              <Field label="Account holder (your verified name)">
                <input
                  value={verifiedName}
                  readOnly
                  aria-readonly="true"
                  className={`${INPUT} bg-secondary/60 text-muted-foreground cursor-not-allowed`}
                />
              </Field>
            </div>
          ) : (
            <>
              <Field label="First name (as on your ID)">
                <input
                  required
                  autoComplete="given-name"
                  value={form.firstName}
                  onChange={(e) => set({ firstName: e.target.value })}
                  className={cls("holder_name")}
                />
              </Field>
              <Field label="Last name (as on your ID)">
                <input
                  required
                  autoComplete="family-name"
                  value={form.lastName}
                  onChange={(e) => set({ lastName: e.target.value })}
                  className={cls("holder_name")}
                />
                {hint("holder_name")}
              </Field>
              {needsEmail && (
                <div className="sm:col-span-2">
                  <Field label="Email (for identity verification)">
                    <input
                      required
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(e) => set({ email: e.target.value })}
                      className={INPUT}
                    />
                  </Field>
                </div>
              )}
            </>
          )}
          <Field label="Bank name">
            {corridor.bankNames ? (
              <select
                required
                value={form.bankName}
                onChange={(e) => set({ bankName: e.target.value })}
                className={cls("bank_name")}
              >
                <option value="">Choose your bank</option>
                {corridor.bankNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                required
                autoComplete="off"
                value={form.bankName}
                onChange={(e) => set({ bankName: e.target.value })}
                className={cls("bank_name")}
              />
            )}
            {hint("bank_name")}
          </Field>
          <Field label={corridor.account.label}>
            <input
              required
              autoComplete="off"
              inputMode={corridor.account.inputMode}
              pattern={corridor.account.pattern}
              title={corridor.account.hint}
              value={form.account}
              onChange={(e) => set({ account: e.target.value })}
              className={cls("account_number")}
            />
            {hint("account_number", corridor.account.hint)}
          </Field>
          {fields.filter(isBankDetailField).map((field) => {
            const ui = EXTRA_FIELD_UI[field];
            return (
              <Field key={field} label={ui.label}>
                <input
                  required
                  autoComplete={field === "phone" ? "tel" : "off"}
                  inputMode={ui.inputMode}
                  pattern={ui.pattern}
                  title={ui.hint}
                  value={form.extra[field] ?? ""}
                  onChange={(e) => setExtra(field, e.target.value)}
                  className={cls(field)}
                />
                {hint(field, ui.hint)}
              </Field>
            );
          })}
        </div>

        {fields.includes("address") && (
          <div className="rounded-2xl border border-border/60 p-4">
            <div className="text-sm font-semibold">Your address</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Required by our payout partner for {currency} payouts.
            </p>
            <div className="mt-3 grid sm:grid-cols-2 gap-3">
              <Field label="Street address">
                <input
                  required
                  autoComplete="street-address"
                  value={form.street}
                  onChange={(e) => set({ street: e.target.value })}
                  className={cls("address.street")}
                />
                {hint("address.street")}
              </Field>
              <Field label="City">
                <input
                  required
                  autoComplete="address-level2"
                  value={form.city}
                  onChange={(e) => set({ city: e.target.value })}
                  className={cls("address.city")}
                />
                {hint("address.city")}
              </Field>
              <Field label="State / region">
                <input
                  required
                  autoComplete="address-level1"
                  value={form.state}
                  onChange={(e) => set({ state: e.target.value })}
                  className={cls("address.state")}
                />
                {hint("address.state")}
              </Field>
              <Field label="Postal code">
                <input
                  required
                  autoComplete="postal-code"
                  value={form.postalCode}
                  onChange={(e) => set({ postalCode: e.target.value })}
                  className={cls("address.postal_code")}
                />
                {hint("address.postal_code")}
              </Field>
            </div>
            {flagged.has("address") && !ADDRESS_FIELDS.some((f) => flagged.has(`address.${f}`)) && (
              <p className="mt-2 text-xs text-destructive">{flagged.get("address")}</p>
            )}
          </div>
        )}

        <MobileDock>
          <button
            type="submit"
            form={`payout-details-${payment.id}`}
            disabled={check.isPending}
            className={PRIMARY}
          >
            {check.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Continue <ArrowRight className="w-4 h-4" />
          </button>
        </MobileDock>
        {check.error && <ErrorText error={check.error} />}
      </form>
    </Card>
  );
}

/** The server's verification state decides; only "verified" unlocks Pay Now. */
function VerificationGate({ kyc }: { kyc: KycStatus | undefined }) {
  const queryClient = useQueryClient();
  const newLink = useMutation({
    mutationFn: async () =>
      (await paymentApi<KycStatus>("/api/kyc", { method: "POST", body: {} })).data,
    onSuccess: (data) => {
      queryClient.setQueryData(["kyc"], data);
      if (data.kycLink) window.open(data.kycLink, "_blank", "noopener");
    },
  });
  if (!kyc) {
    return (
      <Card>
        <Skeleton className="h-5 w-48" />
      </Card>
    );
  }
  const openButton = (
    <MobileDock className="flex flex-wrap items-center gap-3 max-sm:gap-1.5">
      {kyc.kycLink ? (
        <a href={kyc.kycLink} target="_blank" rel="noopener noreferrer" className={PRIMARY}>
          Verify with Stables <ExternalLink className="w-4 h-4" />
        </a>
      ) : (
        <button
          type="button"
          onClick={() => newLink.mutate()}
          disabled={newLink.isPending}
          className={PRIMARY}
        >
          {newLink.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Verify with Stables <ExternalLink className="w-4 h-4" />
        </button>
      )}
      <span className="text-xs text-muted-foreground">
        Opens Stables' secure page in a new tab. LamportPay never sees your documents.
      </span>
    </MobileDock>
  );
  return (
    <Card>
      <div className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="w-5 h-5 text-primary" />
        {kyc.state === "kyc_verified"
          ? "Verification complete"
          : kyc.state === "kyc_rejected"
            ? "Verification rejected"
            : kyc.state === "kyc_action_required"
              ? "Action needed to verify"
              : "Verify your details"}
      </div>
      {kyc.providerUnavailable && (
        <Notice tone="info">
          Our payout partner could not be reached just now; this is your last known status.
        </Notice>
      )}
      {kyc.state === "kyc_verified" && (
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="w-4 h-4 text-[color:var(--success)]" />
          {kyc.verifiedName ? `Verified as ${kyc.verifiedName}.` : "Verified."} You can pay now.
        </p>
      )}
      {(kyc.state === "kyc_pending" || kyc.state === "not_registered") && (
        <>
          <p className="text-sm text-muted-foreground">
            Before your payout, our licensed payout partner must verify your identity (once). If
            you've finished on Stables' page, this updates automatically — Pay Now unlocks when
            verification is complete.
          </p>
          {openButton}
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Verification in progress · checking every few seconds
          </p>
        </>
      )}
      {kyc.state === "kyc_action_required" && (
        <>
          <Notice tone="warn">
            Stables needs something more from you
            {kyc.subStatus.length > 0
              ? `: ${kyc.subStatus.join(", ").toLowerCase().replace(/_/g, " ")}`
              : ""}
            .
          </Notice>
          {openButton}
        </>
      )}
      {kyc.state === "kyc_rejected" && (
        <Notice tone="warn">
          Stables rejected the verification, so payouts are not possible. Contact support if you
          think this is a mistake.
        </Notice>
      )}
      {newLink.error && <ErrorText error={newLink.error} />}
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
    <details className="rounded-xl border border-border/60 px-4 py-3">
      <summary className="text-sm cursor-pointer text-muted-foreground">Activity log</summary>
      <ol className="mt-3 space-y-2 text-sm">
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
    </details>
  );
}

// ------------------------------------------------------------------- bits

const INPUT =
  "w-full rounded-xl border border-border bg-background px-3 py-3 sm:py-2.5 text-base sm:text-sm transition focus:outline-none focus:border-primary/60 focus:ring-4 focus:ring-primary/10";
const PRIMARY =
  "inline-flex items-center gap-2 rounded-2xl bg-[image:var(--gradient-hero)] text-white px-5 py-2.5 font-semibold shadow-[0_12px_30px_-10px_oklch(0.52_0.22_275/0.6)] hover:shadow-[0_16px_40px_-10px_oklch(0.52_0.22_275/0.75)] hover:-translate-y-px active:translate-y-0 transition-all disabled:opacity-50 disabled:shadow-none disabled:translate-y-0 disabled:cursor-not-allowed max-sm:w-full max-sm:justify-center max-sm:py-3.5";
const SECONDARY =
  "inline-flex items-center gap-2 rounded-2xl bg-card border border-border px-4 py-2 text-sm font-semibold hover:border-primary/40 hover:bg-secondary transition disabled:opacity-50 max-sm:w-full max-sm:justify-center max-sm:py-3";

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-border/60 bg-card/90 backdrop-blur-xl p-4 sm:p-6 space-y-4 shadow-[var(--shadow-soft)]">
      {children}
    </div>
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

function Notice({
  tone,
  children,
  collapsible = false,
}: {
  tone: "info" | "warn";
  children: ReactNode;
  /** Two lines and a "More" toggle, so long notes don't push the current step down. */
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
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
      <span className="min-w-0">
        <span className={collapsible && !expanded ? "line-clamp-2" : undefined}>{children}</span>
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-xs font-semibold text-primary"
          >
            {expanded ? "Less" : "More"}
          </button>
        )}
      </span>
    </div>
  );
}

/** Signed in with one wallet, another one connected: say so plainly. */
function DifferentWalletHint() {
  return (
    <p className="mt-2 text-center text-xs text-muted-foreground">
      The connected wallet is not the one you signed in with. Your account and verification stay
      with that wallet; continuing signs you in with this one.
    </p>
  );
}

/** Under the sign-in CTA: what the wallet signature is, and the email fallback. */
function EmailSignInHint({ next }: { next: string }) {
  return (
    <p className="mt-2 text-center text-xs text-muted-foreground">
      You sign one message to verify the wallet is yours. It is not a transaction; no funds move.{" "}
      <Link to="/auth" search={{ next }} className="font-medium text-primary hover:underline">
        Use email instead
      </Link>
    </p>
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
