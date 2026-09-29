import "@/lib/buffer-polyfill";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { ArrowRightLeft, Loader2, TriangleAlert } from "lucide-react";

import { PaymentApiError, paymentApi } from "@/lib/payments/api-client";
import type { PaymentView, SwapView } from "@/lib/payments/view";
import { WalletStatusCard, shortAddress } from "./SolanaWallet";

/**
 * The wallet connect card, reporting the connected public key to the page.
 * Connecting shares only the public key; nothing is signed here.
 */
export function WalletKey({ onChange }: { onChange: (publicKey: string | null) => void }) {
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  useEffect(() => onChange(address), [address, onChange]);
  return <WalletStatusCard />;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

type Ordered = { swap: SwapView; transaction: string; payment: PaymentView };
type Relayed = { swap: SwapView; pending: boolean; payment: PaymentView };

export type PaymentSwapPanelProps = {
  paymentId: string;
  /** The wallet the swap is for (from the settlement check). */
  wallet: string;
  /** Coin the payment needs, e.g. "USDC". */
  coin: string;
  /** Missing amount of `coin`, major units. */
  shortfall: string;
  onChanged: (payment: PaymentView) => void;
};

/**
 * Swap the missing amount into the payment's coin, inside the user's own
 * wallet. The server sizes the swap from fresh balances and Stables' prices;
 * the user reviews it, signs it in the wallet, and the result is confirmed on
 * Solana before the payment moves on.
 */
export function PaymentSwapPanel({
  paymentId,
  wallet,
  coin,
  shortfall,
  onChanged,
}: PaymentSwapPanelProps) {
  const { publicKey, signTransaction } = useWallet();
  const connected = publicKey?.toBase58() ?? null;
  const [ordered, setOrdered] = useState<Ordered | null>(null);
  const [busy, setBusy] = useState<"order" | "sign" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SwapView | null>(null);

  const order = useCallback(async () => {
    setError(null);
    setDone(null);
    setBusy("order");
    try {
      const { data } = await paymentApi<Ordered>(`/api/payments/${paymentId}/swaps`, {
        method: "POST",
      });
      setOrdered(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The swap could not be prepared.");
    } finally {
      setBusy(null);
    }
  }, [paymentId]);

  const signAndSwap = useCallback(async () => {
    if (!ordered || !signTransaction) return;
    setError(null);
    setBusy("sign");
    try {
      const tx = VersionedTransaction.deserialize(fromBase64(ordered.transaction));
      // The wallet only signs; the server relays the exact transaction it built.
      const signedTx = await signTransaction(tx);
      setBusy("confirm");
      let { data } = await paymentApi<Relayed>(
        `/api/payments/${paymentId}/swaps/${ordered.swap.id}/execute`,
        { method: "POST", body: { signedTransaction: toBase64(signedTx.serialize()) } },
      );
      // Finalized on Solana takes about 15 seconds; the chain decides the outcome.
      for (let attempt = 0; data.pending && attempt < 40; attempt++) {
        await new Promise((r) => setTimeout(r, 3000));
        data = (
          await paymentApi<Relayed>(`/api/payments/${paymentId}/swaps/${ordered.swap.id}/confirm`, {
            method: "POST",
          })
        ).data;
      }
      setOrdered(null);
      if (data.pending) {
        setError("The swap is still being confirmed. This page updates when it is final.");
      } else {
        setDone(data.swap);
      }
      onChanged(data.payment);
    } catch (e) {
      setError(
        e instanceof PaymentApiError || e instanceof Error
          ? e.message
          : "The swap was not completed.",
      );
    } finally {
      setBusy(null);
    }
  }, [ordered, signTransaction, paymentId, onChanged]);

  const wrongWallet = connected !== null && connected !== wallet;

  return (
    <div className="space-y-4">
      <WalletStatusCard />
      {wrongWallet && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          This swap is for {shortAddress(wallet)}. Connect that wallet to sign it.
        </div>
      )}

      {!ordered ? (
        <button
          type="button"
          onClick={() => void order()}
          disabled={busy !== null || connected !== wallet}
          className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 font-semibold hover:opacity-90 transition disabled:opacity-50"
        >
          {busy === "order" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ArrowRightLeft className="w-4 h-4" />
          )}
          {busy === "order" ? "Preparing the swap…" : `Swap for the missing ${shortfall} ${coin}`}
        </button>
      ) : (
        <div className="rounded-2xl border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 p-4 space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Step 1 of 2: you spend about{" "}
              <strong>
                {ordered.swap.inAmount} {ordered.swap.inputAsset.toUpperCase()}
              </strong>{" "}
              and receive at least{" "}
              <strong>
                {ordered.swap.minOut} {ordered.swap.outputAsset.toUpperCase()}
              </strong>{" "}
              in your own wallet. It stays there even if the payment does not go ahead. Step 2 is
              sending exactly the payment amount.
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void signAndSwap()}
              disabled={busy !== null || !signTransaction || wrongWallet}
              className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy === "sign"
                ? "Approve in your wallet…"
                : busy === "confirm"
                  ? "Confirming on Solana…"
                  : "Sign and swap"}
            </button>
            <button
              type="button"
              onClick={() => setOrdered(null)}
              disabled={busy !== null}
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="rounded-xl border border-border bg-secondary px-4 py-3 text-sm">
          {done.status === "landed"
            ? `Swap confirmed: ${done.actualOut} ${done.outputAsset.toUpperCase()} arrived in your wallet.`
            : `Swap ${done.status}: ${done.failureReason ?? "nothing was swapped."}`}
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
