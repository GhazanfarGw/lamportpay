/**
 * LamportPay's Jupiter integrator fee for every swap order: the swap fee from
 * business settings (admin dashboard or LAMPORTPAY_SWAP_FEE_BPS) and the
 * referral account in JUPITER_REFERRAL_ACCOUNT. Jupiter takes the fee inside
 * the swap and pays it to the referral account's token accounts (it keeps 20%);
 * nothing passes through a LamportPay wallet and the user signs their own swap.
 * Null (no fee) until the owner has created the referral account.
 */
import { getBusinessSettings } from "@/lib/business-settings.server";
import { JupiterError, swapReferralFrom, type SwapReferral } from "./client.server";

export async function currentSwapReferral(): Promise<SwapReferral | null> {
  let swapFeeBps: number;
  try {
    swapFeeBps = (await getBusinessSettings()).swapFeeBps;
  } catch (e) {
    console.error("[jupiter] business settings:", e instanceof Error ? e.message : e);
    throw new JupiterError("Swaps are temporarily unavailable.", 503);
  }
  return swapReferralFrom(swapFeeBps);
}
