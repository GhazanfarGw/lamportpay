import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AlertTriangle, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBusinessSettingsAdmin, updateBusinessSettingsAdmin } from "@/lib/admin.functions";

type Coin = "usdc" | "usdt";
const COINS: Coin[] = ["usdc", "usdt"];

/** Only the named fields change; null returns a field to its .env default. */
type SettingsPatch = {
  conversionFeeBps?: number | null;
  swapFeeBps?: number | null;
  revenueWallet?: string | null;
  enabledCurrencies?: Coin[] | null;
  note?: string;
};

/** "2" or "2.5" percent → basis points; null when not a valid percentage. */
function percentToBps(value: string, max: number): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const bps = Math.round(Number(value) * 100);
  return bps >= 0 && bps <= max ? bps : null;
}

function Source({ value }: { value: "admin" | "env" }) {
  return (
    <span className="text-[11px] rounded-full border border-border/60 px-2 py-0.5 text-muted-foreground">
      {value === "admin" ? "set here" : ".env default"}
    </span>
  );
}

/**
 * LamportPay's business settings: conversion fee, swap fee, revenue wallet and
 * payment coins. Saved values override .env; "Use .env" clears the override.
 * Every change is written to the audit log. No secrets are shown or edited here.
 */
export function BusinessSettingsAdmin() {
  const queryClient = useQueryClient();
  const fetchSettings = useServerFn(getBusinessSettingsAdmin);
  const save = useServerFn(updateBusinessSettingsAdmin);
  const query = useQuery({ queryKey: ["business-settings"], queryFn: () => fetchSettings() });
  const settings = query.data?.settings ?? null;

  const [fee, setFee] = useState("");
  const [swapFee, setSwapFee] = useState("");
  const [wallet, setWallet] = useState("");
  const [walletConfirm, setWalletConfirm] = useState("");
  const [coins, setCoins] = useState<Coin[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!settings) return;
    setFee(String(settings.conversionFeeBps / 100));
    setSwapFee(String(settings.swapFeeBps / 100));
    setWallet(settings.revenueWallet ?? "");
    setWalletConfirm("");
    setCoins(settings.enabledCurrencies);
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (patch: SettingsPatch) => save({ data: patch }),
    onSuccess: (result) => {
      toast.success(result.changed ? "Settings saved" : "Nothing changed");
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["business-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (query.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading settings…</div>;
  }

  const feeBps = percentToBps(fee, 1000);
  const swapBps = percentToBps(swapFee, 255);
  const swapValid = swapBps !== null && (swapBps === 0 || swapBps >= 50);
  const walletChanged = wallet.trim() !== (settings?.revenueWallet ?? "");
  const walletValid = wallet.trim() === "" || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet.trim());
  const walletConfirmed =
    !walletChanged || wallet.trim() === "" || walletConfirm.trim() === wallet.trim();
  const canSave =
    feeBps !== null && swapValid && walletValid && walletConfirmed && coins.length > 0;
  const referral = query.data?.jupiterReferralAccount ?? null;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-primary" />
        <h2 className="text-lg font-semibold">Fees and revenue</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Changes apply to new quotes within about 10 seconds. A payment keeps the fee it was quoted
        with. The fee is paid by the customer in the same transaction as the deposit, straight to
        the revenue wallet; customer funds never pass through a LamportPay wallet.
      </p>

      {query.data?.error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm flex gap-2">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          Current settings are invalid, so payments are paused: {query.data.error}
        </div>
      )}

      {settings && (
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="space-y-1.5 text-sm">
            <span className="flex items-center gap-2 font-medium">
              Conversion fee (%) <Source value={settings.sources.conversionFeeBps} />
            </span>
            <Input value={fee} inputMode="decimal" onChange={(e) => setFee(e.target.value)} />
            <span className="text-xs text-muted-foreground">0–10%. Added on top of the quote.</span>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="flex items-center gap-2 font-medium">
              Swap fee (%) <Source value={settings.sources.swapFeeBps} />
            </span>
            <Input
              value={swapFee}
              inputMode="decimal"
              onChange={(e) => setSwapFee(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              0 or 0.5–2.55% (Jupiter's range; Jupiter keeps 20%).{" "}
              {referral
                ? "Active: referral account set."
                : "Inactive until JUPITER_REFERRAL_ACCOUNT is set in .env."}
            </span>
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="flex items-center gap-2 font-medium">
              Revenue wallet (Solana, receives USDC){" "}
              <Source value={settings.sources.revenueWallet} />
            </span>
            <Input
              value={wallet}
              className="font-mono text-xs"
              placeholder="Company wallet address"
              onChange={(e) => setWallet(e.target.value)}
            />
            {walletChanged && wallet.trim() !== "" && (
              <Input
                value={walletConfirm}
                className="font-mono text-xs"
                placeholder="Type the new address again to confirm"
                onChange={(e) => setWalletConfirm(e.target.value)}
              />
            )}
            <span className="text-xs text-muted-foreground">
              Only LamportPay's own fee goes here. Customers never see this address in the app.
              {!walletValid && " Not a valid Solana address."}
              {walletChanged &&
                wallet.trim() !== "" &&
                !walletConfirmed &&
                " Addresses don't match."}
            </span>
          </label>
          <div className="space-y-1.5 text-sm sm:col-span-2">
            <span className="flex items-center gap-2 font-medium">
              Payment coins <Source value={settings.sources.enabledCurrencies} />
            </span>
            <div className="flex gap-4">
              {COINS.map((coin) => (
                <label key={coin} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={coins.includes(coin)}
                    onChange={(e) =>
                      setCoins((current) =>
                        e.target.checked
                          ? COINS.filter((c) => c === coin || current.includes(c))
                          : current.filter((c) => c !== coin),
                      )
                    }
                  />
                  {coin.toUpperCase()}
                </label>
              ))}
            </div>
          </div>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Reason (for the audit log)</span>
            <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!canSave || mutation.isPending || !settings}
          onClick={() => {
            // Send only what changed, so untouched values keep following .env.
            const s = settings!;
            mutation.mutate({
              ...(feeBps !== s.conversionFeeBps && { conversionFeeBps: feeBps }),
              ...(swapBps !== s.swapFeeBps && { swapFeeBps: swapBps }),
              ...(walletChanged && { revenueWallet: wallet.trim() || null }),
              ...(coins.join() !== s.enabledCurrencies.join() && { enabledCurrencies: coins }),
              ...(note.trim() && { note: note.trim() }),
            });
          }}
        >
          Save settings
        </Button>
        <Button
          variant="outline"
          disabled={mutation.isPending || !settings}
          onClick={() =>
            mutation.mutate({
              conversionFeeBps: null,
              swapFeeBps: null,
              revenueWallet: null,
              enabledCurrencies: null,
              note: note.trim() || "Reset to .env defaults",
            })
          }
        >
          Use .env for all
        </Button>
      </div>
      {settings?.updatedAt && (
        <p className="text-xs text-muted-foreground">
          Last changed {new Date(settings.updatedAt).toLocaleString()}.
        </p>
      )}
    </section>
  );
}
