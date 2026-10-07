/**
 * Live estimate for the /pay calculator, before any wallet is connected and
 * before anything is created (read only; nothing is stored or signed):
 *   - Stables: a preview quote for the amount and destination — exchange rate,
 *     the payout partner's own fees and the amount the bank account receives;
 *   - LamportPay: the one service fee, from the shared fee model;
 *   - Jupiter: a read-only quote (no wallet, no transaction). Paying in USDC it
 *     shows what the same total would cost in SOL (ExactOut); paying in SOL the
 *     amount typed is SOL and Jupiter's ExactIn quote gives the USDC it buys,
 *     which is then what the user sends (fee and limits apply to it).
 * Jupiter has no devnet: its quote is always a mainnet price, even in TEST
 * MODE, where swap transactions themselves are blocked (app-mode.server.ts).
 * Every provider number is live; nothing is estimated locally. The firm quote
 * is still taken later, after identity verification, by the payment flow.
 */
import {
  activeControls,
  feeModelOf,
  getBusinessSettings,
  limitsForCorridor,
} from "@/lib/business-settings.server";
import { pauseRefusal } from "@/lib/payments/controls";
import { getOrder, isJupiterConfigured, JupiterError } from "@/lib/jupiter/client.server";
import { toMajor, toMinor } from "@/lib/money";
import { splitTotal } from "@/lib/payments/fee-math";
import { PaymentError, requireStables } from "@/lib/payments/service.server";
import { priceCandidates } from "@/lib/payments/settlement.server";
import { PAYMENT_CURRENCY_MINTS, SOL_MINT, type PaymentCurrency } from "@/lib/tokens";

/** What Jupiter's read-only quote reported (all values as returned; none estimated). */
export type SolSwapQuote = {
  status: "quoted";
  /** exact_in: SOL typed by the user; exact_out: SOL needed for the coin total. */
  direction: "exact_in" | "exact_out";
  solIn: string;
  /** Coin out of the swap (major units). */
  coinOut: string;
  /** Jupiter's own swap fee in basis points, and the coin it is taken in. */
  jupiterFeeBps: number | null;
  jupiterFeeMint: "sol" | "usdc" | "usdt" | null;
  priceImpactPct: number | null;
  slippageBps: number;
  routeLabels: string[];
  /** Always "mainnet": Jupiter has no devnet. */
  network: "mainnet";
};

export type LiveEstimate = {
  checkedAt: string;
  coin: PaymentCurrency;
  /** What the user pays with: the stablecoin itself, or SOL swapped by Jupiter. */
  payWith: PaymentCurrency | "sol";
  /** SOL typed by the user (payWith sol only). */
  solAmount: string | null;
  /** What the user sends in the coin (as entered, or what the SOL buys). */
  amount: string;
  /** What goes to the payout partner: the amount sent minus LamportPay's fee. */
  converted: string;
  payout:
    | {
        status: "priced";
        country: string;
        currency: string;
        /** What the bank account receives, per the Stables preview quote. */
        receives: string;
        rate: number;
        partnerFees: Array<{ kind: string; amount: string; currency: string }>;
      }
    | { status: "refused"; reason: string };
  lamportpayFee: { bps: number; amount: string; rule: string };
  /** Converted + LamportPay fee: equals `amount` (at most a rounding unit below). */
  totalFromWallet: string;
  /** The Jupiter side, when requested (or paying in SOL) and available. */
  sol: SolSwapQuote | { status: "unavailable"; reason: string } | null;
};

const MINT_COINS: Record<string, "sol" | "usdc" | "usdt"> = {
  [SOL_MINT]: "sol",
  [PAYMENT_CURRENCY_MINTS.usdc]: "usdc",
  [PAYMENT_CURRENCY_MINTS.usdt]: "usdt",
};

export async function liveEstimate(input: {
  /** The coin amount (payWith = the coin) or the SOL amount (payWith = "sol"). */
  amount: string;
  country: string;
  currency: string;
  coin: PaymentCurrency;
  withSol: boolean;
  payWith?: PaymentCurrency | "sol";
}): Promise<LiveEstimate> {
  const config = requireStables();
  let settings;
  try {
    settings = await getBusinessSettings();
  } catch {
    throw new PaymentError("Payments are temporarily unavailable.", 503, "settings_unavailable");
  }
  if (!settings.enabledCurrencies.includes(input.coin)) {
    throw new PaymentError(`${input.coin.toUpperCase()} is turned off.`, 400, "currency_disabled");
  }
  const paused = pauseRefusal(activeControls(settings), input.currency);
  if (paused) throw new PaymentError(paused.message, paused.status, paused.code);
  const paySol = input.payWith === "sol";

  // Paying in SOL: Jupiter's ExactIn quote says how much of the coin the SOL
  // buys; that is what the user sends. Without a route there is nothing to price.
  let sol: LiveEstimate["sol"] = null;
  let solAmount: string | null = null;
  let sendMinor: bigint;
  if (paySol) {
    let lamports: bigint;
    try {
      lamports = toMinor(input.amount, "sol");
    } catch {
      throw new PaymentError("Enter a SOL amount with at most 9 decimals.", 400, "invalid_amount");
    }
    if (lamports <= 0n)
      throw new PaymentError("Enter an amount above zero.", 400, "invalid_amount");
    solAmount = toMajor(lamports, "sol");
    const quoted = await solQuote(input.coin, lamports, "ExactIn");
    if (quoted.status !== "quoted") {
      throw new PaymentError(quoted.reason, 503, "swap_quote_unavailable");
    }
    sol = quoted;
    sendMinor = toMinor(quoted.coinOut, input.coin);
  } else {
    try {
      sendMinor = toMinor(input.amount, input.coin);
    } catch {
      throw new PaymentError("Enter an amount with at most 6 decimals.", 400, "invalid_amount");
    }
  }
  if (sendMinor <= 0n) throw new PaymentError("Enter an amount above zero.", 400, "invalid_amount");

  const country = input.country.toUpperCase();
  const currency = input.currency.toLowerCase();
  // The fee comes out of what the user sends; the payout partner prices the rest.
  const split = splitTotal(sendMinor, feeModelOf(settings));
  const amountMinor = split.netMinor;
  const fee = { minor: split.feeMinor, rule: split.rule };
  const totalMinor = amountMinor + fee.minor;

  const [{ candidates }, solCost] = await Promise.all([
    priceCandidates(config, {
      amountMinor,
      country,
      currency,
      coins: [input.coin],
      limits: limitsForCorridor(settings, currency),
      // Limits apply to what the user sends (owner decision 2 Oct 2026).
      limitAmountMinor: totalMinor,
    }),
    !paySol && input.withSol ? solQuote(input.coin, totalMinor, "ExactOut") : Promise.resolve(sol),
  ]);
  const c = candidates[0]!;

  return {
    checkedAt: new Date().toISOString(),
    coin: input.coin,
    payWith: paySol ? "sol" : input.coin,
    solAmount,
    amount: toMajor(sendMinor, input.coin),
    converted: toMajor(amountMinor, input.coin),
    payout:
      c.verdict === "priced"
        ? {
            status: "priced",
            country,
            currency,
            receives: c.quote.destination.amount,
            rate: c.rate,
            partnerFees: Object.entries(c.quote.fees ?? {})
              .filter(([, f]) => f && typeof f.amount === "string")
              .map(([kind, f]) => ({
                kind,
                amount: f!.amount,
                currency: f!.currency.toLowerCase(),
              })),
          }
        : { status: "refused", reason: c.reason },
    lamportpayFee: {
      bps: settings.conversionFeeBps,
      amount: toMajor(fee.minor, input.coin),
      rule: fee.rule,
    },
    totalFromWallet: toMajor(totalMinor, input.coin),
    sol: solCost,
  };
}

/**
 * Read-only Jupiter quote (no taker: no transaction is built, nothing can be
 * signed). ExactIn: what `amountMinor` lamports buy. ExactOut: the SOL needed
 * for `amountMinor` of the coin. Mainnet prices (Jupiter has no devnet).
 */
async function solQuote(
  coin: PaymentCurrency,
  amountMinor: bigint,
  swapMode: "ExactIn" | "ExactOut",
): Promise<SolSwapQuote | { status: "unavailable"; reason: string }> {
  if (!isJupiterConfigured()) return { status: "unavailable", reason: "Swaps are not configured." };
  try {
    const order = await getOrder({
      inputMint: SOL_MINT,
      outputMint: PAYMENT_CURRENCY_MINTS[coin],
      amount: amountMinor,
      swapMode,
    });
    return {
      status: "quoted",
      direction: swapMode === "ExactIn" ? "exact_in" : "exact_out",
      solIn: toMajor(order.inAmount, "sol"),
      coinOut: toMajor(order.outAmount, coin),
      jupiterFeeBps: order.feeBps,
      jupiterFeeMint: order.feeMint ? (MINT_COINS[order.feeMint] ?? null) : null,
      priceImpactPct: order.priceImpactPct,
      slippageBps: order.slippageBps,
      routeLabels: order.routeLabels,
      network: "mainnet",
    };
  } catch (e) {
    if (e instanceof JupiterError) {
      return { status: "unavailable", reason: "Jupiter has no route for this amount right now." };
    }
    throw e;
  }
}
