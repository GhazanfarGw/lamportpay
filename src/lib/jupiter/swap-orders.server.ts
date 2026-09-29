/**
 * Standalone swaps (the /swap page): SOL → USDC in the user's own wallet.
 *
 * The server relays only what it issued, and only once:
 *  - `/api/jupiter/order` stores the order Jupiter built for the signed-in user.
 *  - `/api/jupiter/execute` relays a signed transaction only if it belongs to an
 *    order this user was issued, has exactly that order's message, carries a
 *    valid signature by the order's taker, has not expired, and was never
 *    relayed before (a conditional `ordered → relayed` update decides).
 *
 * Non-custodial: the taker is the user's own wallet, the user signs in their
 * wallet, and the server never signs. Payment-bound swaps live in
 * `src/lib/payments/swaps.server.ts`; this module is only for the /swap page.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  JupiterError,
  checkSignedAgainstOrder,
  executeOrder,
  getOrder,
  type JupiterExecution,
} from "@/lib/jupiter/client.server";
import { SOL_MINT, USDC_MINT } from "@/lib/tokens";
import { currentSwapReferral } from "./referral.server";

/** An order's blockhash is only valid for about a minute; refuse anything older than this. */
export const SWAP_ORDER_TTL_MS = 2 * 60_000;

export class SwapOrderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SwapOrderError";
  }
}

export type IssuedOrder = {
  transaction: string;
  requestId: string;
  outAmount: string;
  lastValidBlockHeight: string | null;
};

/** Build a SOL → USDC order for `taker` and remember it for this user. */
export async function issueSwapOrder(p: {
  userId: string;
  taker: string;
  lamports: bigint;
}): Promise<IssuedOrder> {
  const order = await getOrder({
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amount: p.lamports,
    taker: p.taker,
    referral: await currentSwapReferral(),
  });
  if (!order.transaction) {
    throw new JupiterError("Jupiter returned no transaction to sign.", 422);
  }

  const { error } = await supabaseAdmin.from("jupiter_swap_orders").insert({
    user_id: p.userId,
    taker: p.taker,
    input_mint: SOL_MINT,
    output_mint: USDC_MINT,
    in_amount_minor: Number(order.inAmount),
    jupiter_request_id: order.requestId,
    order_transaction: order.transaction,
    expires_at: new Date(Date.now() + SWAP_ORDER_TTL_MS).toISOString(),
  });
  if (error) {
    console.error("[jupiter] could not store order", error.code ?? error.message);
    throw new SwapOrderError("Could not prepare the swap. Try again shortly.", 503);
  }

  return {
    transaction: order.transaction,
    requestId: order.requestId,
    outAmount: order.outAmount.toString(),
    lastValidBlockHeight: order.lastValidBlockHeight?.toString() ?? null,
  };
}

const REFUSED: Record<string, string> = {
  malformed: "The signed transaction could not be read.",
  message_mismatch: "The signed transaction does not match the order.",
  taker_not_signer: "The signed transaction does not match the order.",
  taker_signature_missing: "The transaction is not signed by the order's wallet.",
};

/** Relay a user-signed transaction for an order this user was issued, at most once. */
export async function relaySwapOrder(p: {
  userId: string;
  requestId: string;
  signedTransaction: string;
}): Promise<JupiterExecution> {
  const { data: order, error } = await supabaseAdmin
    .from("jupiter_swap_orders")
    .select("*")
    .eq("jupiter_request_id", p.requestId)
    .eq("user_id", p.userId)
    .maybeSingle();
  if (error) {
    console.error("[jupiter] could not load order", error.code ?? error.message);
    throw new SwapOrderError("Could not check the swap. Try again shortly.", 503);
  }
  // Unknown, or another user's: the same answer, so request IDs cannot be probed.
  if (!order) throw new SwapOrderError("Unknown swap order. Create a new order.", 404);
  if (order.status !== "ordered") {
    throw new SwapOrderError("This swap order was already submitted.", 409);
  }
  if (Date.parse(order.expires_at) <= Date.now()) {
    throw new SwapOrderError("The swap order expired. Create a new order.", 409);
  }

  const check = checkSignedAgainstOrder({
    signedTransaction: p.signedTransaction,
    orderTransaction: order.order_transaction,
    taker: order.taker,
  });
  if (!check.ok) throw new SwapOrderError(REFUSED[check.reason] ?? "Invalid transaction.", 400);

  // The replay guard: only one caller can move this order out of "ordered".
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("jupiter_swap_orders")
    .update({ status: "relayed", relayed_at: new Date().toISOString() })
    .eq("id", order.id)
    .eq("status", "ordered")
    .select("id")
    .maybeSingle();
  if (claimError) {
    console.error("[jupiter] could not claim order", claimError.code ?? claimError.message);
    throw new SwapOrderError("Could not submit the swap. Try again shortly.", 503);
  }
  if (!claimed) throw new SwapOrderError("This swap order was already submitted.", 409);

  let result: JupiterExecution;
  try {
    result = await executeOrder({
      signedTransaction: p.signedTransaction,
      requestId: order.jupiter_request_id,
    });
  } catch (e) {
    // Outcome unknown: the order stays "relayed" and is never sent again.
    await record(order.id, {
      signature: check.transactionId,
      jupiter_status: "unknown",
      jupiter_error: e instanceof Error ? e.message : "Relay failed.",
    });
    throw e;
  }
  await record(order.id, {
    signature: result.signature ?? check.transactionId,
    jupiter_status: result.status,
    jupiter_error: result.error,
  });
  return result;
}

async function record(
  id: string,
  patch: { signature: string | null; jupiter_status: string; jupiter_error: string | null },
) {
  const { error } = await supabaseAdmin
    .from("jupiter_swap_orders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("[jupiter] could not record swap result", error.code ?? error.message);
}
