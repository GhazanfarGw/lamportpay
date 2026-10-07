/**
 * TEST MODE "Pay Now" (owner decision, 3 Oct 2026).
 *
 * The Stables sandbox gives no real deposit address, so a real devnet USDC
 * deposit to Stables is impossible. To still exercise wallet approval, payment
 * detection and the explorer link with genuine test resources, the user's
 * wallet signs a real devnet transaction that moves NO funds: a Memo-program
 * instruction "LamportPay TEST payment <payment id>" signed by their own wallet
 * (only the devnet network fee is spent). Nothing is sent to any LamportPay
 * wallet. The server then reads that transaction from devnet and checks:
 *
 *   - the server is in TEST MODE (refused otherwise — LIVE uses real funding);
 *   - the payment is the caller's own, has a sandbox transfer, and waits for funds;
 *   - the transaction succeeded, carries exactly this payment's memo, and is
 *     signed by the caller's wallet (linked wallet, or the wallet the payment
 *     was planned with for email accounts);
 *   - it is newer than the transfer and has never been used for another payment.
 *
 * Only then is the deposit simulated in the Stables sandbox. Stables' webhooks
 * and the reconciliation job drive the payment to COMPLETED; nothing here marks
 * it complete. Never a fake success: a missing or wrong transaction is refused.
 */
import { MODE_PROFILES } from "@/lib/app-mode";
import { currentMode, requireModeProfile } from "@/lib/app-mode.server";
import { isLikelySignature } from "@/lib/solana-rpc";
import { readWalletHoldings } from "@/lib/solana-balances.server";
import { rpc } from "@/lib/solana-rpc.server";
import type { AuthenticatedUser } from "./auth.server";
import { PaymentError } from "./errors";
import * as ledger from "./ledger.server";
import {
  assertPaymentsOpen,
  FUNDABLE,
  latestSettlement,
  ownedPayment,
  simulateSandboxDeposit,
  viewOf,
} from "./service.server";
import type { PaymentView } from "./view";

import { MEMO_PROGRAM_ID, testPaymentMemo } from "./test-payment";

export { MEMO_PROGRAM_ID, testPaymentMemo };

type ParsedInstruction = {
  programId?: string;
  program?: string;
  parsed?: unknown;
};

type ParsedTransaction = {
  blockTime: number | null;
  meta: { err: unknown } | null;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean }>;
      instructions: ParsedInstruction[];
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Wallets the caller may pay from: their linked wallet(s), else the planned wallet. */
async function allowedPayers(user: AuthenticatedUser, paymentId: string): Promise<string[]> {
  if (user.wallets && user.wallets.length > 0) return user.wallets;
  const planned = (await latestSettlement(paymentId))?.wallet;
  return planned ? [planned] : [];
}

export async function confirmTestPayment(
  user: AuthenticatedUser,
  paymentId: string,
  signature: string,
): Promise<PaymentView> {
  const status = currentMode();
  const profile = requireModeProfile(status);
  if (status.mode !== "test" || profile.realFunds) {
    throw new PaymentError(
      "This is the TEST MODE payment check; LIVE payments use the real deposit.",
      409,
      "test_mode_only",
    );
  }
  if (!isLikelySignature(signature)) {
    throw new PaymentError("Invalid transaction signature.", 400, "invalid_signature");
  }

  const payment = await ownedPayment(user, paymentId);
  await assertPaymentsOpen(null, { globalOnly: true, paymentId: payment.id });
  const events = await ledger.listPaymentEvents(payment.id);
  const detected = events.find((e) => e.kind === "test_payment_detected");
  if (detected) {
    // Duplicate protection: one payment transaction per payment.
    const prior = isRecord(detected.detail) ? detected.detail["signature"] : null;
    if (prior === signature) return viewOf(payment);
    throw new PaymentError(
      "This payment has already been paid. Nothing more needs to be signed.",
      409,
      "already_paid",
    );
  }
  if (!payment.transfer_id || !FUNDABLE.includes(ledger.paymentState(payment))) {
    throw new PaymentError(
      `This payment is not waiting for a payment (it is ${payment.status}).`,
      409,
    );
  }
  if (await ledger.getPaymentEventBySignature("test_payment_detected", signature)) {
    throw new PaymentError(
      "This transaction was already used for another payment.",
      409,
      "signature_reused",
    );
  }

  const cluster = MODE_PROFILES.test.solanaCluster;
  const read = await rpc<ParsedTransaction | null>(cluster, "getTransaction", [
    signature,
    { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
  ]);
  if (!read.ok) {
    throw new PaymentError(
      "We couldn't reach Solana devnet to check the transaction. Try again shortly.",
      503,
      "rpc_unavailable",
    );
  }
  const tx = read.result;
  if (!tx) {
    throw new PaymentError(
      "The transaction isn't confirmed on devnet yet. Try again in a few seconds.",
      409,
      "not_confirmed",
    );
  }
  if (tx.meta?.err) {
    throw new PaymentError("The transaction failed on devnet.", 422, "transaction_failed");
  }

  const keys = tx.transaction?.message?.accountKeys ?? [];
  const signers = keys.filter((k) => k.signer).map((k) => k.pubkey);
  const payers = await allowedPayers(user, payment.id);
  const wallet = signers.find((s) => payers.includes(s));
  if (!wallet) {
    throw new PaymentError("The transaction wasn't signed by your wallet.", 403, "wrong_wallet");
  }

  const expected = testPaymentMemo(payment.id);
  const memos = (tx.transaction?.message?.instructions ?? [])
    .filter((ix) => ix.programId === MEMO_PROGRAM_ID || ix.program === "spl-memo")
    .map((ix) => (typeof ix.parsed === "string" ? ix.parsed : null));
  if (!memos.includes(expected)) {
    throw new PaymentError("The transaction doesn't belong to this payment.", 422, "memo_mismatch");
  }

  // Realistic TEST: the wallet that approved must actually hold the devnet USDC
  // this payment needs (amount + LamportPay fee), as LIVE would require. The memo
  // transaction itself moves nothing.
  const view = await viewOf(payment);
  const needed = BigInt(view.totalToPay.amountMinor);
  const coin = payment.source_currency as "usdc" | "usdt";
  const holdings = await readWalletHoldings(wallet);
  if (holdings.status !== "ok") {
    throw new PaymentError(
      "We couldn't read your devnet balance. Try again shortly.",
      503,
      "balance_unavailable",
    );
  }
  if ((holdings.tokens[coin] ?? 0n) < needed) {
    throw new PaymentError(
      `Your wallet doesn't hold the ${view.totalToPay.amount} ${coin.toUpperCase()} this payment needs (devnet test ${coin.toUpperCase()}).`,
      409,
      "insufficient_funds",
    );
  }

  const transferEvent = events.find((e) => e.to_status && e.from_status === "QUOTED");
  const transferAt = transferEvent ? Date.parse(transferEvent.created_at) : 0;
  if (tx.blockTime !== null && transferAt && tx.blockTime * 1000 < transferAt - 120_000) {
    throw new PaymentError(
      "This transaction is older than the payment's transfer.",
      422,
      "stale_transaction",
    );
  }

  await ledger.recordEvent(payment.id, "test_payment_detected", "api", {
    detail: {
      signature,
      wallet,
      cluster,
      memo: expected,
      block_time: tx.blockTime,
      moved_funds: false,
    },
  });
  // The sandbox deposit for this transfer (idempotent per transfer).
  await simulateSandboxDeposit(payment.id, { id: user.id, role: "test_payment" });
  return viewOf((await ledger.getPayment(payment.id)) ?? payment);
}
