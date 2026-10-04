/**
 * Payment-bound swaps (docs/wallet-settlement-design.md, Flow step 5): when the
 * wallet does not hold enough of the coin Stables priced, swap the shortfall
 * into it with Jupiter, inside the user's own wallet.
 *
 * Non-custodial throughout: the output always lands in the user's wallet (the
 * taker), the user signs in Phantom or Solflare, and the server only relays a
 * transaction whose message matches the stored order exactly. What happened is
 * decided from the finalized on-chain balance change, never from Jupiter's
 * report. At most one swap per payment is in flight (partial unique index).
 * Mainnet only: refused with the Stables sandbox.
 */
import { VersionedTransaction } from "@solana/web3.js";

import type { Json } from "@/integrations/supabase/types";
import {
  JupiterError,
  checkSignedAgainstOrder,
  executeOrder,
  getOrder,
  isJupiterConfigured,
  messageSha256,
  type JupiterOrder,
} from "@/lib/jupiter/client.server";
import { requireRealFundsMode } from "@/lib/app-mode.server";
import { toMajor } from "@/lib/money";
import { solReserveLamports, tokenAccountRentLamports } from "@/lib/solana-balances.server";
import { rpc } from "@/lib/solana-rpc.server";
import { tokenDelta, type TxResult } from "@/lib/solana-usdc.server";
import {
  PAYMENT_CURRENCY_MINTS,
  SOL_MINT,
  isPaymentCurrency,
  type PaymentCurrency,
} from "@/lib/tokens";
import type { AuthenticatedUser } from "./auth.server";
import { PaymentError } from "./errors";
import * as ledger from "./ledger.server";
import type { PaymentRow, SwapRow } from "./ledger.server";
import type { SwapInput } from "./settlement";
import { planSettlement, settlementDetail, type SettlementPlan } from "./settlement.server";
import { latestSettlement, ownedPayment, requireStables, viewOf } from "./service.server";
import { currentSwapReferral } from "@/lib/jupiter/referral.server";
import { toSwapView, type PaymentView, type SwapView } from "./view";

const DIGITS = /^\d+$/;

/** Extra input on top of the quoted need, so the guaranteed output covers the shortfall. */
function sizeBufferBps(): bigint {
  return envBigint("SWAP_SIZE_BUFFER_BPS", 50n);
}
function maxSlippageBps(): number {
  return Number(envBigint("SWAP_MAX_SLIPPAGE_BPS", 100n));
}
/** Refuse a swap whose price impact is above this, in basis points (100 = 1%). */
function maxPriceImpactBps(): number {
  return Number(envBigint("SWAP_MAX_PRICE_IMPACT_BPS", 100n));
}

function envBigint(name: string, fallback: bigint): bigint {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!DIGITS.test(raw))
    throw new Error(`${name} must be a whole number, not ${JSON.stringify(raw)}.`);
  return BigInt(raw);
}

const label = (asset: string) => asset.toUpperCase();
const assetOfMint = (mint: string): "sol" | PaymentCurrency | "unknown" =>
  mint === SOL_MINT
    ? "sol"
    : ((Object.entries(PAYMENT_CURRENCY_MINTS).find(([, m]) => m === mint)?.[0] ?? "unknown") as
        PaymentCurrency | "unknown");
const units = (minor: bigint, asset: "sol" | PaymentCurrency) =>
  `${toMajor(minor, asset)} ${label(asset)}`;

function requireLiveSwaps() {
  // Jupiter has no devnet: every swap moves real funds, so never in TEST MODE.
  requireRealFundsMode();
  const config = requireStables();
  if (config.environment !== "production") {
    throw new PaymentError(
      "Swaps run on Solana mainnet and are disabled with the Stables sandbox, like on-chain funding.",
      409,
      "sandbox_swap_disabled",
    );
  }
  if (!isJupiterConfigured()) {
    throw new PaymentError("Swaps are not available right now.", 503, "swap_unavailable");
  }
  return config;
}

function fromJupiterError(e: unknown): never {
  if (e instanceof JupiterError) {
    if (e.status === 422) throw new PaymentError(e.message, 422, "swap_not_covered");
    console.error("[jupiter] request failed", e.status, e.message);
    throw new PaymentError(
      "Swaps are not available right now. Try again shortly.",
      503,
      "swap_unavailable",
    );
  }
  throw e;
}

async function recordPlan(payment: PaymentRow, plan: SettlementPlan) {
  await ledger.recordEvent(payment.id, "settlement_selected", "api", {
    detail: settlementDetail(plan),
  });
}

/** Re-price and re-read the wallet for a payment's current coin. */
function replan(payment: PaymentRow, wallet: string, preference: "auto" | PaymentCurrency) {
  return planSettlement(requireStables(), {
    amountMinor: BigInt(payment.source_amount_minor),
    country: payment.destination_country,
    currency: payment.destination_currency,
    wallet,
    preference,
  });
}

export type SwapOrderResult = {
  swap: SwapView;
  /** Unsigned base64 transaction for the user's wallet to sign (not send). */
  transaction: string;
  payment: PaymentView;
};

/**
 * Size and order a swap of the shortfall into the payment's coin. The client
 * sends nothing but the payment: mints, amounts and taker all come from the
 * server's own fresh reads.
 */
export async function orderSwap(
  user: AuthenticatedUser,
  paymentId: string,
): Promise<SwapOrderResult> {
  requireLiveSwaps();
  const payment = await ownedPayment(user, paymentId);
  // A swap is the user's own conversion inside their own wallet; it does not
  // need identity verification (the payout does, at the transfer). It must
  // happen before the firm quote, which in LIVE MODE needs the coin in hand.
  const preQuote = ["PAYMENT_CREATED", "KYC_PENDING", "KYC_APPROVED"].includes(
    ledger.paymentState(payment),
  );
  if (!preQuote || payment.quote_id) {
    throw new PaymentError("A swap is possible only before the quote.", 409, "not_kyc_approved");
  }
  const coin = payment.source_currency;
  if (!isPaymentCurrency(coin)) throw new Error(`Payment ${payment.id} has coin ${coin}.`);

  // Clear a finished swap from the lock before looking for a new one.
  const inFlight = await ledger.currentInFlightSwap(payment.id);
  if (inFlight && (await settleSwap(payment, inFlight)).status === "submitted") {
    throw new PaymentError(
      "A swap for this payment is still being confirmed. Wait for it to finish.",
      409,
      "swap_in_flight",
    );
  }

  const stored = await latestSettlement(payment.id);
  if (!stored?.wallet || stored.kind !== "swap_required" || stored.coin !== coin) {
    throw new PaymentError(
      stored?.reason || "No swap is needed for this payment.",
      409,
      "swap_not_needed",
    );
  }
  const wallet = stored.wallet;

  // Fresh answers from Stables and the chain: the rule, not the client, decides.
  const plan = await replan(payment, wallet, stored.preference);
  const decision = plan.decision;
  if (decision.kind === "funds_ready" && decision.coin === coin) {
    await recordPlan(payment, plan);
    throw new PaymentError(decision.reason, 409, "swap_not_needed");
  }
  if (decision.kind !== "swap_required" || decision.coin !== coin) {
    await recordPlan(payment, plan);
    throw new PaymentError(
      `${decision.reason} Check again before paying.`,
      409,
      "settlement_changed",
    );
  }
  if (plan.holdings?.status !== "ok") {
    throw new PaymentError(
      "We couldn't read your wallet. Try again shortly.",
      503,
      "balance_unavailable",
    );
  }

  const outputMint = PAYMENT_CURRENCY_MINTS[coin];
  const shortfall = decision.shortfallMinor;
  // LamportPay's integrator fee, on the sizing quote too, so the swap still
  // delivers the full shortfall after Jupiter takes the fee.
  let referral: Awaited<ReturnType<typeof currentSwapReferral>>;
  try {
    referral = await currentSwapReferral();
  } catch (e) {
    fromJupiterError(e);
  }
  const sized = await sizeSwap({
    referral,
    wallet,
    outputMint,
    shortfall,
    inputs: decision.swapInputs,
    sol: plan.holdings.solLamports,
  });

  let order: JupiterOrder;
  try {
    order = await getOrder({
      inputMint: sized.inputMint,
      outputMint,
      amount: sized.amount,
      swapMode: "ExactIn",
      taker: wallet,
      referral,
    });
  } catch (e) {
    fromJupiterError(e);
  }
  checkOrderTerms(order, {
    wallet,
    shortfall,
    coin,
    available: sized.available,
    inputAsset: sized.asset,
  });

  const swap = await ledger.insertSwapOrder({
    payment_id: payment.id,
    taker: wallet,
    input_mint: order.inputMint,
    output_mint: order.outputMint,
    swap_mode: order.swapMode,
    shortfall_minor: Number(shortfall),
    in_amount_minor: Number(order.inAmount),
    min_out_minor: Number(order.otherAmountThreshold),
    slippage_bps: order.slippageBps,
    price_impact_pct: order.priceImpactPct,
    jupiter_request_id: order.requestId,
    order_transaction: order.transaction!,
    order_message_sha256: messageSha256(order.transaction!),
    last_valid_block_height:
      order.lastValidBlockHeight === null ? null : Number(order.lastValidBlockHeight),
  });
  await ledger.recordEvent(payment.id, "swap_ordered", "api", {
    detail: {
      swap_id: swap.id,
      attempt: swap.attempt,
      input: sized.asset,
      in_amount_minor: order.inAmount.toString(),
      min_out_minor: order.otherAmountThreshold.toString(),
      shortfall_minor: shortfall.toString(),
      slippage_bps: order.slippageBps,
      price_impact_pct: order.priceImpactPct,
      request_id: order.requestId,
    } as Json,
  });
  return {
    swap: toSwapView(swap),
    transaction: order.transaction!,
    payment: await viewOf(payment),
  };
}

/**
 * Pick the first input that can cover the shortfall with a buffer: SOL above
 * the fee reserve first, then the other payment coin. The need comes from a
 * read-only ExactOut quote (nothing signed).
 */
async function sizeSwap(p: {
  referral: Awaited<ReturnType<typeof currentSwapReferral>>;
  wallet: string;
  outputMint: string;
  shortfall: bigint;
  inputs: SwapInput[];
  sol: bigint;
}): Promise<{ asset: SwapInput["asset"]; inputMint: string; amount: bigint; available: bigint }> {
  const rent = await tokenAccountRentLamports();
  for (const input of p.inputs) {
    const inputMint = input.asset === "sol" ? SOL_MINT : PAYMENT_CURRENCY_MINTS[input.asset];
    let available = input.availableMinor;
    if (input.asset === "sol") {
      // SOL must still cover the swap's own fees and rent, then the deposit's.
      const reserve = await solReserveLamports({
        payer: p.wallet,
        swap: { outputMint: p.outputMint, inputIsSol: true },
      });
      if (reserve === "unavailable" || rent === null) {
        throw new PaymentError(
          "We couldn't check your SOL for network fees. Try again shortly.",
          503,
          "balance_unavailable",
        );
      }
      available = p.sol - reserve - rent;
    }
    if (available <= 0n) continue;

    let need: JupiterOrder;
    try {
      need = await getOrder({
        inputMint,
        outputMint: p.outputMint,
        amount: p.shortfall,
        swapMode: "ExactOut",
        referral: p.referral,
      });
    } catch (e) {
      if (e instanceof JupiterError && e.status === 422) continue;
      fromJupiterError(e);
    }
    const amount = (need.inAmount * (10_000n + sizeBufferBps()) + 9_999n) / 10_000n;
    if (amount <= available) return { asset: input.asset, inputMint, amount, available };
  }
  throw new PaymentError(
    `Your wallet doesn't hold enough to swap for the missing ${units(p.shortfall, assetOfMint(p.outputMint) as PaymentCurrency)}. Add it to your wallet directly, then check again.`,
    422,
    "insufficient_swap_input",
  );
}

/** Refuse, before anything is signed, an order that does not fit the payment. */
function checkOrderTerms(
  order: JupiterOrder,
  p: {
    wallet: string;
    shortfall: bigint;
    coin: PaymentCurrency;
    available: bigint;
    inputAsset: SwapInput["asset"];
  },
) {
  if (!order.transaction || order.lastValidBlockHeight === null) {
    throw new PaymentError(
      "The swap service returned no transaction. Try again.",
      503,
      "swap_unavailable",
    );
  }
  // Gasless orders are paid by a relayer whose signature is the transaction id,
  // known only after relaying: we could not track the swap if the relay failed.
  const feePayer = VersionedTransaction.deserialize(
    Buffer.from(order.transaction, "base64"),
  ).message.staticAccountKeys[0]?.toBase58();
  if (order.gasless || feePayer !== p.wallet) {
    throw new PaymentError(
      "Keep some SOL in your wallet for network fees; swaps for payments are paid from your own wallet.",
      422,
      "needs_sol",
    );
  }
  if (order.otherAmountThreshold < p.shortfall) {
    throw new PaymentError(
      `The swap guarantees only ${units(order.otherAmountThreshold, p.coin)}, less than the missing ${units(p.shortfall, p.coin)}. Try again, or add ${label(p.coin)} directly.`,
      422,
      "swap_not_covered",
    );
  }
  if (order.inAmount > p.available) {
    throw new PaymentError(
      `The swap would spend ${units(order.inAmount, p.inputAsset)}, more than your wallet can spare.`,
      422,
      "insufficient_swap_input",
    );
  }
  if (order.slippageBps > maxSlippageBps()) {
    throw new PaymentError(
      "The swap's price tolerance is too wide right now. Try again shortly.",
      422,
      "swap_not_covered",
    );
  }
  const impactBps = order.priceImpactPct === null ? null : Math.abs(order.priceImpactPct) * 10_000;
  if (impactBps !== null && impactBps > maxPriceImpactBps()) {
    throw new PaymentError(
      "The swap would move the price too much right now. Try again shortly.",
      422,
      "swap_not_covered",
    );
  }
}

export type SwapExecuteResult = { swap: SwapView; pending: boolean; payment: PaymentView };

/**
 * Relay a user-signed swap. Only a transaction with exactly the stored order's
 * message, signed by the taker, is relayed, and never twice: a swap already
 * submitted just reports its state.
 */
export async function executeSwap(
  user: AuthenticatedUser,
  paymentId: string,
  swapId: string,
  signedTransaction: string,
): Promise<SwapExecuteResult> {
  requireLiveSwaps();
  const payment = await ownedPayment(user, paymentId);
  const swap = await ledger.getSwap(payment.id, swapId);
  if (!swap) throw new PaymentError("Swap not found.", 404);
  if (swap.status !== "ordered") {
    const current = await settleSwap(payment, swap);
    return {
      swap: toSwapView(current),
      pending: current.status === "submitted",
      payment: await viewOf(payment),
    };
  }

  const check = checkSignedAgainstOrder({
    signedTransaction,
    orderTransaction: swap.order_transaction,
    taker: swap.taker,
  });
  if (!check.ok || check.transactionId === null) {
    const reason = check.ok ? "taker_not_fee_payer" : check.reason;
    await ledger.recordEvent(
      payment.id,
      reason === "message_mismatch" ? "wallet_modified_transaction" : "swap_rejected",
      "api",
      {
        detail: { swap_id: swap.id, reason },
      },
    );
    throw new PaymentError(
      reason === "message_mismatch"
        ? "Your wallet changed the swap transaction while signing, so it was not sent. Start the swap again."
        : "The signed swap could not be matched to this order, so it was not sent. Start the swap again.",
      409,
      "swap_signature_rejected",
    );
  }

  if (await blockhashExpired(swap)) {
    await ledger.markSwapOutcome(swap.id, ["ordered"], {
      status: "expired",
      failure_reason: "The order expired before it was signed.",
    });
    throw new PaymentError("The swap order expired. Start the swap again.", 409, "swap_expired");
  }

  const write = await ledger.markSwapSubmitted(swap.id, check.transactionId);
  if (write.status === "in_flight") {
    throw new PaymentError(
      "Another swap for this payment is being confirmed.",
      409,
      "swap_in_flight",
    );
  }
  if (write.status === "signature_taken") {
    throw new PaymentError("This transaction was already relayed.", 409, "swap_in_flight");
  }
  if (write.status === "not_ordered") {
    const current = (await ledger.getSwap(payment.id, swap.id))!;
    return {
      swap: toSwapView(current),
      pending: current.status === "submitted",
      payment: await viewOf(payment),
    };
  }
  await ledger.recordEvent(payment.id, "swap_submitted", "api", {
    detail: { swap_id: swap.id, signature: check.transactionId },
  });

  // The outcome of a relay error is unknown, never "failed": the chain decides.
  try {
    const execution = await executeOrder({ signedTransaction, requestId: swap.jupiter_request_id });
    await ledger.markSwapOutcome(swap.id, ["submitted"], {
      jupiter_status: execution.status,
      jupiter_error: execution.error,
    });
  } catch (e) {
    if (!(e instanceof JupiterError)) throw e;
    await ledger.markSwapOutcome(swap.id, ["submitted"], { jupiter_error: e.message });
  }
  const current = await settleSwap(payment, (await ledger.getSwap(payment.id, swap.id))!);
  return {
    swap: toSwapView(current),
    pending: current.status === "submitted",
    payment: await viewOf(payment),
  };
}

/** Poll a swap's on-chain outcome (the client calls this until it is final). */
export async function confirmSwap(
  user: AuthenticatedUser,
  paymentId: string,
  swapId: string,
): Promise<SwapExecuteResult> {
  const payment = await ownedPayment(user, paymentId);
  const swap = await ledger.getSwap(payment.id, swapId);
  if (!swap) throw new PaymentError("Swap not found.", 404);
  const current = await settleSwap(payment, swap);
  return {
    swap: toSwapView(current),
    pending: current.status === "submitted",
    payment: await viewOf(payment),
  };
}

async function blockhashExpired(swap: SwapRow): Promise<boolean> {
  if (swap.last_valid_block_height === null) return false;
  const height = await rpc<number>("mainnet-beta", "getBlockHeight", [{ commitment: "finalized" }]);
  return (
    height.ok && typeof height.result === "number" && height.result > swap.last_valid_block_height
  );
}

/**
 * Decide a submitted swap from the chain at finalized commitment: landed when
 * the taker's output balance rose by at least the guaranteed minimum; failed
 * otherwise; expired when its blockhash can no longer land. Still "submitted"
 * while unknown. A final outcome re-checks the settlement with fresh balances.
 */
async function settleSwap(payment: PaymentRow, swap: SwapRow): Promise<SwapRow> {
  if (swap.status !== "submitted" || !swap.signature) return swap;
  const tx = await rpc<TxResult>("mainnet-beta", "getTransaction", [
    swap.signature,
    { maxSupportedTransactionVersion: 0, commitment: "finalized", encoding: "json" },
  ]);
  if (!tx.ok) return swap;

  let outcome: Parameters<typeof ledger.markSwapOutcome>[2] | null = null;
  let kind = "";
  if (tx.result) {
    const meta = tx.result.meta;
    if (!meta || meta.err != null) {
      outcome = {
        status: "failed",
        failure_reason: "The swap failed on-chain; nothing was swapped.",
      };
      kind = "swap_failed";
    } else {
      const out = tokenDelta(
        meta.preTokenBalances,
        meta.postTokenBalances,
        swap.output_mint,
        swap.taker,
      );
      const spent =
        swap.input_mint === SOL_MINT
          ? lamportsSpent(tx.result, swap.taker)
          : -tokenDelta(meta.preTokenBalances, meta.postTokenBalances, swap.input_mint, swap.taker);
      if (out >= BigInt(swap.min_out_minor)) {
        outcome = {
          status: "landed",
          actual_out_minor: Number(out),
          actual_in_minor: spent === null ? null : Number(spent),
        };
        kind = "swap_landed";
      } else {
        outcome = {
          status: "failed",
          actual_out_minor: Number(out),
          actual_in_minor: spent === null ? null : Number(spent),
          failure_reason: "Less than the guaranteed output reached your wallet.",
        };
        kind = "swap_failed";
      }
    }
  } else if (await blockhashExpired(swap)) {
    outcome = {
      status: "expired",
      failure_reason: "The swap did not land before its blockhash expired.",
    };
    kind = "swap_expired";
  }
  if (!outcome) return swap;

  const updated = await ledger.markSwapOutcome(swap.id, ["submitted"], outcome);
  if (!updated) return (await ledger.getSwap(payment.id, swap.id)) ?? swap;
  await ledger.recordEvent(payment.id, kind, "api", {
    detail: {
      swap_id: swap.id,
      signature: swap.signature,
      actual_out_minor: outcome.actual_out_minor?.toString() ?? null,
      failure_reason: outcome.failure_reason ?? null,
    },
  });
  // Balances changed (or didn't): record where the payment now stands.
  try {
    const stored = await latestSettlement(payment.id);
    await recordPlan(payment, await replan(payment, swap.taker, stored?.preference ?? "auto"));
  } catch (e) {
    console.error(`[swaps] settlement re-check after ${swap.id} failed`, e);
  }
  return updated;
}

/** SOL the taker's account lost in the transaction (fees included); null if unreadable. */
function lamportsSpent(tx: NonNullable<TxResult>, taker: string): bigint | null {
  const index = tx.transaction.message.accountKeys.findIndex(
    (k) => (typeof k === "string" ? k : String((k as { pubkey?: unknown }).pubkey ?? "")) === taker,
  );
  const pre = tx.meta?.preBalances[index];
  const post = tx.meta?.postBalances[index];
  if (index < 0 || pre === undefined || post === undefined) return null;
  return BigInt(pre) - BigInt(post);
}
