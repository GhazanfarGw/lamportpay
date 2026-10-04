/**
 * Pure fee arithmetic shared by the browser and the server. This is the one
 * place LamportPay's fee is calculated (fees.server.ts `conversionFeeMinor`
 * delegates here), so the quote, the "Max" button and the preview always agree.
 *
 * Fee base (owner decision 2026-09-30): the fee is a percentage of the TOTAL
 * the user sends from the wallet, and it comes OUT of that total — it is not
 * added on top. The user enters 150 USDC → LamportPay fee 3.00 (2% of 150) →
 * 147.00 goes to the payout partner; 150.00 leaves the wallet.
 *
 * The engine stores the amount sent to the payout partner ("net", N) and the
 * fee separately, so the fee is expressed from the net amount:
 *   fee(N) = clamp(ceil(N × bps / (10000 − bps)), min, max)
 * which is bps of the total (N + fee): for N = 147 and 2%, fee = 3 and the
 * total is 150. `splitTotal` goes the other way (total → net + fee).
 * - percentage only: bps > 0, no min, no max (the approved 2% model);
 * - with a floor or a cap: add min and/or max (bounds apply to the fee);
 * - a fixed fee: bps = 0 and min = max = the fixed amount.
 * No bps and no min means no fee. Provider costs are never part of this.
 */
const BPS = 10_000n;

export type FeeModel = {
  bps: bigint;
  /** Smallest fee, minor units of the payment coin; null = no minimum. */
  minMinor: bigint | null;
  /** Largest fee, minor units of the payment coin; null = no maximum. */
  maxMinor: bigint | null;
};

/** Which part of the model decided the fee (recorded for audit). */
export type FeeRule = "none" | "percentage" | "minimum" | "maximum";

export function percentageModel(bps: bigint): FeeModel {
  return { bps, minMinor: null, maxMinor: null };
}

/** Whether the model charges anything at all. */
export function chargesFee(model: FeeModel): boolean {
  return model.bps > 0n || (model.minMinor !== null && model.minMinor > 0n);
}

/**
 * LamportPay's fee when `amountMinor` (net) goes to the payout partner, and the
 * rule that decided it. The fee is `bps` of the total (net + fee), rounded up.
 */
export function platformFee(
  amountMinor: bigint,
  model: FeeModel,
): { minor: bigint; rule: FeeRule } {
  if (amountMinor <= 0n || !chargesFee(model)) return { minor: 0n, rule: "none" };
  if (model.bps >= BPS) throw new Error("The fee rate must be below 100%.");
  const rest = BPS - model.bps;
  let minor = model.bps > 0n ? (amountMinor * model.bps + rest - 1n) / rest : 0n;
  let rule: FeeRule = "percentage";
  if (model.minMinor !== null && minor < model.minMinor) {
    minor = model.minMinor;
    rule = "minimum";
  }
  if (model.maxMinor !== null && minor > model.maxMinor) {
    minor = model.maxMinor;
    rule = "maximum";
  }
  return { minor, rule };
}

export function platformFeeMinor(amountMinor: bigint, model: FeeModel): bigint {
  return platformFee(amountMinor, model).minor;
}

/** Percentage-only fee (kept for callers that have just a rate). */
export function lamportpayFeeMinor(amountMinor: bigint, feeBps: bigint): bigint {
  return platformFeeMinor(amountMinor, percentageModel(feeBps));
}

/**
 * The largest amount that can be converted from `balanceMinor` when the fee is
 * paid on top from the same balance: the biggest A with A + fee(A) ≤ balance.
 * amount + fee grows with amount, so a binary search finds it exactly.
 */
export function maxConvertibleFor(balanceMinor: bigint, model: FeeModel): bigint {
  if (balanceMinor <= 0n) return 0n;
  let lo = 0n;
  let hi = balanceMinor;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (mid + platformFeeMinor(mid, model) <= balanceMinor) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

export function maxConvertibleMinor(balanceMinor: bigint, feeBps: bigint): bigint {
  return maxConvertibleFor(balanceMinor, percentageModel(feeBps));
}

/**
 * Split what the user sends (`totalMinor`, from the wallet) into the amount the
 * payout partner receives (net) and LamportPay's fee, with net + fee ≤ total
 * (equal in practice; at most a rounding unit below).
 */
export function splitTotal(
  totalMinor: bigint,
  model: FeeModel,
): { netMinor: bigint; feeMinor: bigint; rule: FeeRule } {
  const netMinor = maxConvertibleFor(totalMinor, model);
  const fee = platformFee(netMinor, model);
  return { netMinor, feeMinor: fee.minor, rule: fee.rule };
}
