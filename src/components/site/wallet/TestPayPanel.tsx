import "@/lib/buffer-polyfill";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Loader2, ShieldCheck } from "lucide-react";

import { PaymentApiError, paymentApi } from "@/lib/payments/api-client";
import { MEMO_PROGRAM_ID, testPaymentMemo } from "@/lib/payments/test-payment";
import type { PaymentView } from "@/lib/payments/view";
import { walletActionErrorMessage } from "@/lib/wallet-sign-in";

const MEMO_PROGRAM = new PublicKey(MEMO_PROGRAM_ID);

export type TestPayPanelProps = {
  paymentId: string;
  /** Runs first (e.g. creates the Stables transfer); a throw stops before any signature. */
  prepare?: () => Promise<void>;
  /** Disabled until every server-side condition is met (verified, quote valid…). */
  disabled?: boolean;
  label?: string;
  /** The wallet the payment was prepared (balance-checked) for; others are refused before signing. */
  expectedWallet?: string | null;
  /**
   * Start the wallet approval as soon as the wallet is ready (once). Used when the
   * user already clicked Pay Now and the screen moved on after the transfer was
   * created; the wallet still asks the user to approve.
   */
  autoStart?: boolean;
  onAutoStarted?: () => void;
  onPaid: (payment: PaymentView) => void;
};

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Ask the server to verify the devnet transaction, retrying while it confirms. */
async function confirmTestPayment(paymentId: string, signature: string): Promise<PaymentView> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2500));
    try {
      return (
        await paymentApi<PaymentView>(`/api/payments/${paymentId}/test-payment`, {
          method: "POST",
          body: { signature },
        })
      ).data;
    } catch (e) {
      last = e;
      if (!(e instanceof PaymentApiError) || e.code !== "not_confirmed") throw e;
    }
  }
  throw last ?? new Error("The transaction isn't confirmed on devnet yet.");
}

/**
 * TEST MODE "Pay Now": the connected wallet signs a real Solana devnet
 * transaction that moves no funds (a memo naming this payment). The server
 * verifies it on devnet, then the Stables sandbox simulates the deposit.
 */
export function TestPayPanel({
  paymentId,
  prepare,
  disabled = false,
  label = "Pay now",
  expectedWallet,
  autoStart = false,
  onAutoStarted,
  onPaid,
}: TestPayPanelProps) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [busy, setBusy] = useState<"prepare" | "sign" | "detect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const pay = useCallback(async () => {
    if (running.current) return; // duplicate-click protection
    if (!publicKey) return setError("Connect your wallet first.");
    if (expectedWallet && publicKey.toBase58() !== expectedWallet) {
      return setError(
        `This payment was prepared for wallet ${shortAddress(expectedWallet)}. Switch to that wallet, or start a new conversion with this one.`,
      );
    }
    running.current = true;
    setError(null);
    try {
      if (prepare) {
        setBusy("prepare");
        await prepare();
      }
      setBusy("sign");
      // One memo instruction in a v0 transaction, signed and paid by the user's wallet.
      const memo = new TransactionInstruction({
        programId: MEMO_PROGRAM,
        keys: [{ pubkey: publicKey, isSigner: true, isWritable: false }],
        data: new TextEncoder().encode(testPaymentMemo(paymentId)) as Buffer,
      });
      const latest = await connection.getLatestBlockhash("confirmed");
      const tx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: latest.blockhash,
          instructions: [memo],
        }).compileToV0Message(),
      );
      const signature = await sendTransaction(tx, connection);

      setBusy("detect");
      await connection.confirmTransaction({ signature, ...latest }, "confirmed");
      onPaid(await confirmTestPayment(paymentId, signature));
    } catch (e) {
      setError(
        e instanceof PaymentApiError ? e.message : walletActionErrorMessage(e, "Payment failed."),
      );
    } finally {
      running.current = false;
      setBusy(null);
    }
  }, [publicKey, expectedWallet, prepare, paymentId, sendTransaction, connection, onPaid]);

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current || disabled || !connected || !publicKey) return;
    autoStarted.current = true;
    onAutoStarted?.();
    void pay();
  }, [autoStart, disabled, connected, publicKey, pay, onAutoStarted]);

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={disabled || !connected || busy !== null}
        onClick={() => void pay()}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[image:var(--gradient-hero)] px-6 py-3.5 text-base font-semibold text-white shadow-[var(--shadow-elegant)] transition hover:opacity-95 disabled:opacity-50"
      >
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {busy === "prepare"
          ? "Preparing your payment…"
          : busy === "sign"
            ? "Approve in your wallet…"
            : busy === "detect"
              ? "Detecting your payment on devnet…"
              : label}
      </button>
      {busy === "sign" && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground" role="status">
          <ShieldCheck className="w-4 h-4 shrink-0 text-primary" />
          Review and approve this transaction in your wallet. TEST MODE: it is a Solana devnet
          transaction that moves no funds — only a tiny devnet network fee. Never share your seed
          phrase.
        </p>
      )}
      {!connected && (
        <p className="text-xs text-muted-foreground">Connect your wallet (top right) to pay.</p>
      )}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}

export default TestPayPanel;
