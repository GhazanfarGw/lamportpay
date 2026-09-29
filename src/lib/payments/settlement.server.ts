/**
 * Settlement choice for a payment (docs/wallet-settlement-design.md): which
 * coin the user pays Stables in, and whether a swap is needed first.
 *
 * Stables decides what it can price: every payment coin within our limits gets
 * a preview quote. The user's wallet decides what they hold: real mainnet
 * balances, never invented (a failed read is "unavailable", not zero). The pure
 * rule in `settlement.ts` combines the two.
 */
import type { Json } from "@/integrations/supabase/types";
import { getBusinessSettings } from "@/lib/business-settings.server";
import { toMajor, toMinor } from "@/lib/money";
import {
  readWalletHoldings,
  solReserveLamports,
  tokenAccountRentLamports,
  type WalletHoldings,
} from "@/lib/solana-balances.server";
import * as stables from "@/lib/stables/client.server";
import { StablesError } from "@/lib/stables/client.server";
import type { StablesConfig } from "@/lib/stables/config.server";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "@/lib/tokens";
import { PaymentError } from "./errors";
import { conversionFeeMinor } from "./fees.server";
import { getPaymentLimits, limitsMessage, outsideLimits } from "./limits.server";
import {
  classifyPreview,
  decideSettlement,
  type Candidate,
  type Holdings,
  type Preference,
  type SettlementDecision,
} from "./settlement";

type Configured = Extract<StablesConfig, { configured: true }>;

/** Stables' own error for a coin it refused to price (its status, code and wording). */
export type PreviewFailure = { status: number; code?: string; message: string };

export type PricedCandidates = {
  candidates: Candidate[];
  /** Stables' raw answer for each refused coin, for messages that quote Stables. */
  failures: Partial<Record<PaymentCurrency, PreviewFailure>>;
};

export type SettlementPlan = {
  decision: SettlementDecision;
  failures: Partial<Record<PaymentCurrency, PreviewFailure>>;
  /** Null when no wallet was given. */
  holdings: WalletHoldings | null;
  /** SOL to keep for fees and rent; null when it could not be read. */
  reserveLamports: bigint | null;
  /** LamportPay's fee on top of the amount, at the current settings. */
  platformFee: { bps: number; minor: bigint; wallet: string | null };
  /** Coins turned on in business settings, in order. */
  enabledCurrencies: PaymentCurrency[];
  wallet: string | null;
  preference: Preference;
  checkedAt: string;
};

function minorOrNull(amount: string, currency: string): bigint | null {
  try {
    return toMinor(amount, currency, "round");
  } catch {
    return null;
  }
}

/**
 * Price `amountMinor` of every payment coin for this destination with Stables
 * preview quotes (not persisted), in parallel. Coins outside our configured
 * limits are not sent to Stables.
 */
export async function priceCandidates(
  config: Configured,
  input: {
    amountMinor: bigint;
    country: string;
    currency: string;
    /** Coins turned on; every payment coin when omitted. */
    coins?: readonly PaymentCurrency[];
  },
): Promise<PricedCandidates> {
  const failures: PricedCandidates["failures"] = {};
  const candidates = await Promise.all(
    (input.coins ?? PAYMENT_CURRENCIES).map(async (coin): Promise<Candidate> => {
      let limits;
      try {
        limits = getPaymentLimits(coin);
      } catch (e) {
        console.error("[payments] invalid payment limits:", e instanceof Error ? e.message : e);
        throw new PaymentError(
          "Payments are temporarily unavailable.",
          503,
          "limits_misconfigured",
        );
      }
      if (outsideLimits(input.amountMinor, limits)) {
        return {
          coin,
          verdict: "out_of_limits",
          code: null,
          reason: limitsMessage(limits, coin.toUpperCase()),
        };
      }
      const base = {
        coin,
        amountMinor: input.amountMinor,
        destinationCurrency: input.currency,
        decimals: {
          source: (amount: string) => minorOrNull(amount, coin) ?? -1n,
          destination: (amount: string) => minorOrNull(amount, input.currency),
          fee: (amount: string, currency: string) => minorOrNull(amount, currency),
        },
      };
      try {
        const quote = await stables.createQuote(config, {
          source: { currency: coin, network: "solana", amount: toMajor(input.amountMinor, coin) },
          destination: { currency: input.currency, country: input.country, network: "bank" },
          preview: true,
        });
        return classifyPreview({ ...base, quote });
      } catch (e) {
        if (!(e instanceof StablesError)) throw e;
        if (e.status === 401 || e.status === 403) {
          console.error("[stables] credentials refused", e.status, e.message);
          throw new PaymentError(
            "The payout partner is unavailable. Try again shortly.",
            502,
            "stables_unavailable",
          );
        }
        const failure = { status: e.status, code: e.code, message: e.message };
        failures[coin] = failure;
        return classifyPreview({ ...base, error: failure });
      }
    }),
  );
  return { candidates, failures };
}

function decisionHoldings(holdings: WalletHoldings | null, reserveKnown: boolean): Holdings {
  if (!holdings) return null;
  if (holdings.status !== "ok") return { status: "unavailable", reason: holdings.reason };
  // Without the fee reserve we cannot say whether funding would succeed.
  if (!reserveKnown)
    return { status: "unavailable", reason: "Could not read the SOL fee reserve." };
  return { status: "ok", solLamports: holdings.solLamports, tokens: holdings.tokens };
}

/**
 * SOL the payer must keep before paying: fees plus, since the Stables deposit
 * address is not known before the transfer, rent for its token account in
 * case it has to be created. Null when a read failed.
 */
async function reserveFor(wallet: string): Promise<bigint | null> {
  const [reserve, rent] = await Promise.all([
    solReserveLamports({ payer: wallet }),
    tokenAccountRentLamports(),
  ]);
  if (reserve === "unavailable" || rent === null) return null;
  return reserve + rent;
}

/** Business settings for a plan; misconfiguration pauses payments rather than guessing. */
async function settingsForPlan() {
  try {
    return await getBusinessSettings();
  } catch (e) {
    console.error("[payments] business settings:", e instanceof Error ? e.message : e);
    throw new PaymentError("Payments are temporarily unavailable.", 503, "settings_unavailable");
  }
}

/**
 * Price every coin that is turned on, read the wallet, and decide. The wallet
 * must hold the amount plus LamportPay's fee (paid in the same transaction).
 */
export async function planSettlement(
  config: Configured,
  input: {
    amountMinor: bigint;
    country: string;
    currency: string;
    wallet: string | null;
    preference: Preference;
  },
): Promise<SettlementPlan> {
  const settings = await settingsForPlan();
  const enabled = settings.enabledCurrencies;
  if (input.preference !== "auto" && !enabled.includes(input.preference)) {
    throw new PaymentError(
      `${input.preference.toUpperCase()} payments are turned off. Pay with ${enabled.map((c) => c.toUpperCase()).join(" or ")}.`,
      400,
      "currency_disabled",
    );
  }
  const feeMinor = conversionFeeMinor(input.amountMinor, BigInt(settings.conversionFeeBps));
  const [{ candidates, failures }, holdings] = await Promise.all([
    priceCandidates(config, { ...input, coins: enabled }),
    input.wallet ? readWalletHoldings(input.wallet) : Promise.resolve(null),
  ]);
  const reserveLamports =
    holdings?.status === "ok" && input.wallet ? await reserveFor(input.wallet) : null;
  const decision = decideSettlement({
    amountMinor: input.amountMinor,
    requiredMinor: input.amountMinor + feeMinor,
    candidates,
    holdings: decisionHoldings(holdings, reserveLamports !== null),
    preference: input.preference,
    solReserveLamports: reserveLamports,
    order: enabled,
  });
  return {
    decision,
    failures,
    holdings,
    reserveLamports,
    platformFee: {
      bps: settings.conversionFeeBps,
      minor: feeMinor,
      wallet: feeMinor > 0n ? settings.revenueWallet : null,
    },
    enabledCurrencies: enabled,
    wallet: input.wallet,
    preference: input.preference,
    checkedAt: new Date().toISOString(),
  };
}

/** The chosen coin's priced candidate, when the decision has one. */
export function chosenCandidate(
  plan: SettlementPlan,
): Extract<Candidate, { verdict: "priced" }> | null {
  const coin = "coin" in plan.decision ? plan.decision.coin : null;
  const found = plan.decision.candidates.find((c) => c.coin === coin);
  return found?.verdict === "priced" ? found : null;
}

const str = (value: bigint | null | undefined) => (value == null ? null : value.toString());

/**
 * Timeline detail of a settlement check: every coin's verdict, the balances
 * read (minor units as strings, or why they could not be read), and the choice.
 * `view.ts` reads this back for the settlement card.
 */
export function settlementDetail(plan: SettlementPlan): Json {
  const d = plan.decision;
  const holdings = !plan.holdings
    ? null
    : plan.holdings.status === "ok"
      ? {
          status: "ok",
          sol_lamports: plan.holdings.solLamports.toString(),
          tokens: Object.fromEntries(
            Object.entries(plan.holdings.tokens).map(([coin, v]) => [coin, v.toString()]),
          ),
          slot: plan.holdings.slot,
          read_at: plan.holdings.readAt,
        }
      : { status: "unavailable", reason: plan.holdings.reason };
  return {
    kind: d.kind,
    coin: "coin" in d ? d.coin : null,
    reason: d.reason,
    ...(d.kind === "none_priced" && { error: d.error }),
    ...((d.kind === "swap_required" || d.kind === "insufficient_funds") && {
      shortfall_minor: d.shortfallMinor.toString(),
    }),
    ...(d.kind === "swap_required" && {
      swap_inputs: d.swapInputs.map((i) => ({
        asset: i.asset,
        available_minor: i.availableMinor.toString(),
      })),
    }),
    ...(d.kind === "needs_sol" && { sol_needed_lamports: d.solNeededLamports.toString() }),
    candidates: d.candidates.map((c) =>
      c.verdict === "priced"
        ? {
            coin: c.coin,
            verdict: c.verdict,
            destination_amount_minor: c.destinationAmountMinor.toString(),
            total_fee_minor: str(c.totalFeeMinor),
            rate: c.rate,
          }
        : { coin: c.coin, verdict: c.verdict, code: c.code, reason: c.reason },
    ),
    wallet: plan.wallet,
    preference: plan.preference,
    holdings,
    reserve_lamports: str(plan.reserveLamports),
    platform_fee_bps: plan.platformFee.bps,
    platform_fee_minor: plan.platformFee.minor.toString(),
    checked_at: plan.checkedAt,
  } as Json;
}

/** The coin a stored settlement check chose, when it chose one. */
export function isPaymentCoin(value: unknown): value is PaymentCurrency {
  return (PAYMENT_CURRENCIES as readonly unknown[]).includes(value);
}
