import "@/lib/buffer-polyfill";
import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { Loader2, Send, TriangleAlert } from "lucide-react";

import { PaymentApiError, paymentApi } from "@/lib/payments/api-client";
import { WalletStatusCard } from "./SolanaWallet";

export type FundingPanelProps = {
  paymentId: string;
  amount: string;
  /** Stablecoin label, "USDC" or "USDT". */
  currency?: string;
  depositAddress: string;
  /** LamportPay's fee, sent in the same transaction; omitted when there is none. */
  platformFee?: string | null;
  onFunded: () => void;
};

type BuiltTransaction = {
  transaction: string;
  amount: string;
  depositAddress: string;
  platformFee?: string;
  total?: string;
};

/** Sum of two decimal strings with at most 6 decimals (display only). */
function addAmounts(a: string, b: string): string {
  const minor = (v: string) => {
    const [whole = "0", frac = ""] = v.split(".");
    return BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  };
  const sum = minor(a) + minor(b);
  const frac = (sum % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${sum / 1_000_000n}${frac ? `.${frac}` : ""}`;
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Ask the server to verify `signature`, retrying while the transaction is not
 * finalized yet (finalization takes roughly 15 seconds after it lands).
 */
async function confirmFunding(paymentId: string, signature: string, payer: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    const { status } = await paymentApi(`/api/payments/${paymentId}/funding`, {
      method: "POST",
      body: { signature, payer },
    });
    if (status !== 202) return;
  }
  throw new PaymentApiError(
    "Sent, but not confirmed yet. Paste the signature below to retry verification.",
    202,
  );
}

/**
 * Sends the exact deposit amount of the payment's stablecoin (USDC or USDT)
 * from the connected wallet to the Stables deposit address. The transaction is
 * built by the server from the stored deposit instructions, so the amount,
 * token and destination cannot drift.
 */
export function FundingPanel({
  paymentId,
  amount,
  currency = "USDC",
  depositAddress,
  platformFee = null,
  onFunded,
}: FundingPanelProps) {
  const hasFee = platformFee !== null && Number(platformFee) > 0;
  const total = hasFee ? addAmounts(amount, platformFee!) : amount;
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [busy, setBusy] = useState<"build" | "send" | "verify" | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const send = useCallback(async () => {
    if (!publicKey) return setError("Connect a wallet first.");
    setError(null);
    setConfirmOpen(false);
    try {
      setBusy("build");
      const { data } = await paymentApi<BuiltTransaction>(
        `/api/payments/${paymentId}/funding-transaction`,
        { method: "POST", body: { payer: publicKey.toBase58() } },
      );
      // The server builds the transaction; it must match what the page showed.
      if (
        data.depositAddress !== depositAddress ||
        data.amount !== amount ||
        (hasFee &&
          (data.platformFee === undefined || Number(data.platformFee) !== Number(platformFee)))
      ) {
        throw new Error("Deposit instructions changed. Refresh the page before sending.");
      }

      setBusy("send");
      const tx = Transaction.from(fromBase64(data.transaction));
      const sig = await sendTransaction(tx, connection);
      setSignature(sig);

      setBusy("verify");
      await confirmFunding(paymentId, sig, publicKey.toBase58());
      onFunded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sending failed.");
    } finally {
      setBusy(null);
    }
  }, [
    publicKey,
    paymentId,
    depositAddress,
    amount,
    hasFee,
    platformFee,
    sendTransaction,
    connection,
    onFunded,
  ]);

  return (
    <div className="space-y-4">
      <WalletStatusCard />

      {!confirmOpen ? (
        <button
          type="button"
          disabled={!connected || busy !== null || Boolean(signature)}
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 font-semibold hover:opacity-90 transition disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {busy === "build"
            ? "Preparing…"
            : busy === "send"
              ? "Approve in your wallet…"
              : busy === "verify"
                ? "Verifying on Solana…"
                : `Send ${total} ${currency}`}
        </button>
      ) : (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <TriangleAlert className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <span>
              This sends{" "}
              <strong>
                {amount} {currency}
              </strong>{" "}
              on Solana mainnet to the single-use Stables deposit address
              {hasFee && (
                <>
                  {" "}
                  and the{" "}
                  <strong>
                    {platformFee} {currency}
                  </strong>{" "}
                  LamportPay fee, <strong>{total}</strong> in total, in one transaction
                </>
              )}
              . On-chain transfers cannot be reversed.
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void send()}
              className="rounded-full bg-destructive text-white px-4 py-2 text-sm font-semibold hover:opacity-90"
            >
              Send now
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {signature && (
        <div className="text-xs text-muted-foreground break-all">
          Signature: <span className="font-mono">{signature}</span>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}

export default FundingPanel;
