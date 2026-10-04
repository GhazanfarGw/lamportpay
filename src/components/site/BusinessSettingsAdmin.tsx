import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { ConfirmButton, LoadingState, Panel } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { toMinor } from "@/lib/money";
import { getBusinessSettingsAdmin, updateBusinessSettingsAdmin } from "@/lib/admin.functions";

type Coin = "usdc" | "usdt";
const COINS: Coin[] = ["usdc", "usdt"];

/** Only the named fields change; null returns a field to its .env default. */
type SettingsPatch = {
  conversionFeeBps?: number | null;
  feeMinMinor?: number | null;
  feeMaxMinor?: number | null;
  revenueWallet?: string | null;
  enabledCurrencies?: Coin[] | null;
  paymentLimits?: Partial<Record<Coin, { minMinor: number; maxMinor: number | null } | null>>;
  note?: string;
};

/** "2" or "2.5" percent → basis points; null when not a valid percentage. */
function percentToBps(value: string, max: number): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const bps = Math.round(Number(value) * 100);
  return bps >= 0 && bps <= max ? bps : null;
}

/** "" → 0 (no bound); "1.5" → 1500000 (6 decimals); null when invalid. */
function boundToMinor(value: string): number | null {
  const v = value.trim();
  if (v === "") return 0;
  if (!/^\d+(\.\d{1,6})?$/.test(v)) return null;
  try {
    return Number(toMinor(v, "usdc"));
  } catch {
    return null;
  }
}

function Source({ value }: { value: "admin" | "env" | "test_mode" }) {
  return (
    <span className="text-[11px] rounded-full border border-border/60 px-2 py-0.5 text-muted-foreground">
      {value === "admin"
        ? "set in admin"
        : value === "test_mode"
          ? "TEST MODE limit (stored value applies in LIVE MODE)"
          : ".env default"}
    </span>
  );
}

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function useSettings() {
  const queryClient = useQueryClient();
  const fetchSettings = useServerFn(getBusinessSettingsAdmin);
  const save = useServerFn(updateBusinessSettingsAdmin);
  const query = useQuery({ queryKey: ["business-settings"], queryFn: () => fetchSettings() });
  const mutation = useMutation({
    mutationFn: (patch: SettingsPatch) => save({ data: patch }),
    onSuccess: (result) => {
      toast.success(result.changed ? "Saved and written to the audit log" : "Nothing changed");
      void queryClient.invalidateQueries({ queryKey: ["business-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-system-status"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return { query, mutation };
}

function InvalidNotice({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm flex gap-2">
      <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
      Current settings are invalid, so payments are paused: {error}
    </div>
  );
}

/**
 * The ONE LamportPay fee and the revenue wallet (owner decision 2026-09-30:
 * one total fee, never a conversion fee plus a swap fee). Saved values
 * override .env; every change is audit logged with a reason.
 */
export function FeeAndWalletSettings() {
  const { query, mutation } = useSettings();
  const settings = query.data?.settings ?? null;
  const [fee, setFee] = useState("");
  const [feeMin, setFeeMin] = useState("");
  const [feeMax, setFeeMax] = useState("");
  const [wallet, setWallet] = useState("");
  const [walletConfirm, setWalletConfirm] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!settings) return;
    setFee(String(settings.conversionFeeBps / 100));
    setFeeMin(settings.feeMin ?? "");
    setFeeMax(settings.feeMax ?? "");
    setWallet(settings.revenueWallet ?? "");
    setWalletConfirm("");
  }, [settings]);

  if (query.isLoading) return <LoadingState label="Loading fee settings…" />;

  const feeBps = percentToBps(fee, 1000);
  const trimmed = wallet.trim();
  const walletChanged = trimmed !== (settings?.revenueWallet ?? "");
  const walletValid = trimmed === "" || SOLANA_ADDRESS.test(trimmed);
  const walletConfirmed = !walletChanged || trimmed === "" || walletConfirm.trim() === trimmed;
  const feeChanged = feeBps !== null && feeBps !== settings?.conversionFeeBps;
  const minMinor = boundToMinor(feeMin);
  const maxMinor = boundToMinor(feeMax);
  const boundsValid =
    minMinor !== null &&
    maxMinor !== null &&
    (minMinor === 0 || maxMinor === 0 || minMinor <= maxMinor);
  const minChanged = minMinor !== null && feeMin.trim() !== (settings?.feeMin ?? "");
  const maxChanged = maxMinor !== null && feeMax.trim() !== (settings?.feeMax ?? "");
  const canSave =
    !!settings &&
    feeBps !== null &&
    boundsValid &&
    walletValid &&
    walletConfirmed &&
    (feeChanged || minChanged || maxChanged || walletChanged) &&
    reason.trim().length >= 3;

  return (
    <Panel
      title="LamportPay fee and revenue wallet"
      description="One total LamportPay fee, added on top of the Stables quote and paid in the same user-signed transaction straight to the revenue wallet. Customer funds never pass through a LamportPay wallet. A payment keeps the fee it was quoted with."
    >
      <InvalidNotice error={query.data?.error} />
      {settings && (
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="space-y-1.5 text-sm">
            <span className="flex items-center gap-2 font-medium">
              LamportPay fee (%) <Source value={settings.sources.conversionFeeBps} />
            </span>
            <Input value={fee} inputMode="decimal" onChange={(e) => setFee(e.target.value)} />
            <span className="text-xs text-muted-foreground">
              Total fee the customer pays (approved: 2%). 0 turns the fee off.
              {feeBps === null && " Enter a percentage from 0 to 10."}
            </span>
          </label>
          <div className="space-y-1.5 text-sm">
            <span className="font-medium">Status</span>
            <p className="text-sm">
              {(settings.conversionFeeBps > 0 || settings.feeMin) && settings.revenueWallet
                ? `Charging ${settings.conversionFeeBps / 100}%${
                    settings.feeMin ? `, at least ${settings.feeMin}` : ""
                  }${settings.feeMax ? `, at most ${settings.feeMax}` : ""} on new quotes.`
                : "Fee is off: no fee is charged."}
            </p>
          </div>
          <label className="space-y-1.5 text-sm">
            <span className="flex items-center gap-2 font-medium">
              Minimum fee (USDC, optional) <Source value={settings.sources.feeMin} />
            </span>
            <Input
              value={feeMin}
              inputMode="decimal"
              placeholder="No minimum"
              onChange={(e) => setFeeMin(e.target.value)}
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="flex items-center gap-2 font-medium">
              Maximum fee (USDC, optional) <Source value={settings.sources.feeMax} />
            </span>
            <Input
              value={feeMax}
              inputMode="decimal"
              placeholder="No maximum"
              onChange={(e) => setFeeMax(e.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Still one fee per payment: the percentage, kept within these bounds. Leave both empty
            for the plain percentage (approved model). A fixed fee is 0% with the same minimum and
            maximum.
            {!boundsValid &&
              " Enter amounts with up to 6 decimals; the minimum must not exceed the maximum."}
          </p>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="flex items-center gap-2 font-medium">
              Revenue wallet (public Solana address, receives USDC){" "}
              <Source value={settings.sources.revenueWallet} />
            </span>
            <Input
              value={wallet}
              className="font-mono text-xs"
              placeholder="Company wallet address (public address only)"
              onChange={(e) => setWallet(e.target.value)}
            />
            {walletChanged && trimmed !== "" && (
              <Input
                value={walletConfirm}
                className="font-mono text-xs"
                placeholder="Type the new address again to confirm"
                onChange={(e) => setWalletConfirm(e.target.value)}
              />
            )}
            <span className="text-xs text-muted-foreground">
              Only LamportPay's own fee goes here. Never enter a private key or seed phrase.
              Customers see only a "LamportPay fee" line.
              {!walletValid && " Not a valid Solana address."}
              {walletChanged && trimmed !== "" && !walletConfirmed && " The addresses don't match."}
            </span>
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Reason for the change (required, audit log)</span>
            <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <ConfirmButton
          variant="default"
          size="default"
          disabled={!canSave || mutation.isPending}
          title="Save fee and wallet settings?"
          description={
            <div className="space-y-1">
              {feeChanged && (
                <p>
                  LamportPay fee: {settings!.conversionFeeBps / 100}% → {feeBps! / 100}%
                </p>
              )}
              {minChanged && (
                <p>
                  Minimum fee: {settings!.feeMin ?? "none"} → {feeMin.trim() || "none"}
                </p>
              )}
              {maxChanged && (
                <p>
                  Maximum fee: {settings!.feeMax ?? "none"} → {feeMax.trim() || "none"}
                </p>
              )}
              {walletChanged && (
                <p className="break-all">
                  Revenue wallet: {settings!.revenueWallet ?? "none"} → {trimmed || "none"}
                </p>
              )}
              <p>New quotes use this within about 10 seconds. It is written to the audit log.</p>
            </div>
          }
          confirmLabel="Save"
          onConfirm={() =>
            mutation.mutate(
              {
                ...(feeChanged && { conversionFeeBps: feeBps }),
                ...(minChanged && { feeMinMinor: minMinor }),
                ...(maxChanged && { feeMaxMinor: maxMinor }),
                ...(walletChanged && { revenueWallet: trimmed || null }),
                note: reason.trim(),
              },
              { onSuccess: () => setReason("") },
            )
          }
        >
          Save changes
        </ConfirmButton>
        <ConfirmButton
          disabled={mutation.isPending || !settings || reason.trim().length < 3}
          title="Use the .env values?"
          description="The fee and the revenue wallet go back to the values in the server's .env."
          confirmLabel="Use .env"
          onConfirm={() =>
            mutation.mutate({
              conversionFeeBps: null,
              feeMinMinor: null,
              feeMaxMinor: null,
              revenueWallet: null,
              note: reason.trim(),
            })
          }
        >
          Use .env values
        </ConfirmButton>
      </div>
      {settings?.updatedAt && (
        <p className="text-xs text-muted-foreground">
          Last changed {new Date(settings.updatedAt).toLocaleString()}.
        </p>
      )}
    </Panel>
  );
}

/** Which payment coins are turned on (owner decision: USDC only for now). */
export function PaymentCoinSettings() {
  const { query, mutation } = useSettings();
  const settings = query.data?.settings ?? null;
  const [coins, setCoins] = useState<Coin[]>([]);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (settings) setCoins(settings.enabledCurrencies);
  }, [settings]);

  if (query.isLoading) return <LoadingState label="Loading settings…" />;
  const changed = !!settings && coins.join() !== settings.enabledCurrencies.join();

  return (
    <Panel
      title="Payment coins"
      description="Coins customers can pay with. A turned-off coin is not quoted or accepted; payments already quoted keep their coin."
    >
      <InvalidNotice error={query.data?.error} />
      {settings && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Source value={settings.sources.enabledCurrencies} />
          </div>
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
          <label className="block space-y-1.5">
            <span className="font-medium">Reason (required, audit log)</span>
            <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
      )}
      <ConfirmButton
        variant="default"
        size="default"
        disabled={!changed || coins.length === 0 || reason.trim().length < 3 || mutation.isPending}
        title="Change payment coins?"
        description={`Customers will be able to pay with: ${coins.map((c) => c.toUpperCase()).join(", ") || "nothing"}.`}
        confirmLabel="Save"
        onConfirm={() =>
          mutation.mutate(
            { enabledCurrencies: coins, note: reason.trim() },
            { onSuccess: () => setReason("") },
          )
        }
      >
        Save coins
      </ConfirmButton>
    </Panel>
  );
}

/** "100" → 100000000 (6 decimals); null when invalid or not positive. */
function limitToMinor(value: string): number | null {
  const v = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(v)) return null;
  try {
    const minor = Number(toMinor(v, "usdc"));
    return minor > 0 ? minor : null;
  } catch {
    return null;
  }
}

/**
 * LamportPay's own per-payment limits per coin (C07). Stables still applies its
 * own per-customer limits on top. Empty maximum = no LamportPay maximum (owner
 * decision 2026-09-29: "maximum as per Stables' limits"). Audit logged with a
 * reason; "Use .env" returns a coin to the server environment values.
 */
export function PaymentLimitSettings() {
  const { query, mutation } = useSettings();
  const settings = query.data?.settings ?? null;
  const [form, setForm] = useState<Record<Coin, { min: string; max: string }>>({
    usdc: { min: "", max: "" },
    usdt: { min: "", max: "" },
  });
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!settings) return;
    setForm({
      usdc: {
        min: settings.paymentLimits.usdc?.min ?? "",
        max: settings.paymentLimits.usdc?.max ?? "",
      },
      usdt: {
        min: settings.paymentLimits.usdt?.min ?? "",
        max: settings.paymentLimits.usdt?.max ?? "",
      },
    });
  }, [settings]);

  if (query.isLoading) return <LoadingState label="Loading limits…" />;

  const parsed = COINS.map((coin) => {
    const minMinor = limitToMinor(form[coin].min);
    const maxMinor = form[coin].max.trim() === "" ? null : limitToMinor(form[coin].max);
    const valid =
      minMinor !== null &&
      (form[coin].max.trim() === "" || (maxMinor !== null && maxMinor >= minMinor));
    const current = settings?.paymentLimits[coin];
    const changed =
      !!settings &&
      (form[coin].min.trim() !== (current?.min ?? "") ||
        form[coin].max.trim() !== (current?.max ?? ""));
    return { coin, minMinor, maxMinor, valid, changed };
  });
  const changes = parsed.filter((p) => p.changed);
  const canSave =
    !!settings && changes.length > 0 && changes.every((p) => p.valid) && reason.trim().length >= 3;

  return (
    <Panel
      title="Payment limits"
      description="LamportPay's own minimum and maximum per payment. Stables applies its own per-customer limits on top. Leave the maximum empty for no LamportPay maximum. A payment is checked again against these limits when it is quoted."
    >
      <InvalidNotice error={query.data?.error} />
      {settings && (
        <div className="space-y-4 text-sm">
          {COINS.map((coin) => {
            const p = parsed.find((x) => x.coin === coin)!;
            return (
              <div key={coin} className="grid sm:grid-cols-[80px_1fr_1fr] items-end gap-3">
                <div className="font-medium flex flex-col gap-1">
                  {coin.toUpperCase()}
                  <Source value={settings.sources.paymentLimits[coin]} />
                </div>
                <label className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">Minimum</span>
                  <Input
                    value={form[coin].min}
                    inputMode="decimal"
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [coin]: { ...f[coin], min: e.target.value } }))
                    }
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">Maximum</span>
                  <Input
                    value={form[coin].max}
                    inputMode="decimal"
                    placeholder="No LamportPay maximum"
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [coin]: { ...f[coin], max: e.target.value } }))
                    }
                  />
                </label>
                {!p.valid && (
                  <p className="text-xs text-destructive sm:col-span-3">
                    Enter a positive amount (up to 6 decimals); the maximum must not be below the
                    minimum.
                  </p>
                )}
              </div>
            );
          })}
          <label className="block space-y-1.5">
            <span className="font-medium">Reason (required, audit log)</span>
            <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <ConfirmButton
          variant="default"
          size="default"
          disabled={!canSave || mutation.isPending}
          title="Change payment limits?"
          description={
            <div className="space-y-1">
              {changes.map((p) => (
                <p key={p.coin}>
                  {p.coin.toUpperCase()}: {settings!.paymentLimits[p.coin]?.min ?? "invalid"} –{" "}
                  {settings!.paymentLimits[p.coin]?.max ?? "no maximum"} → {form[p.coin].min.trim()}{" "}
                  – {form[p.coin].max.trim() || "no maximum"}
                </p>
              ))}
              <p>New payments and quotes use this within about 10 seconds.</p>
            </div>
          }
          confirmLabel="Save"
          onConfirm={() =>
            mutation.mutate(
              {
                paymentLimits: Object.fromEntries(
                  changes.map((p) => [p.coin, { minMinor: p.minMinor!, maxMinor: p.maxMinor }]),
                ),
                note: reason.trim(),
              },
              { onSuccess: () => setReason("") },
            )
          }
        >
          Save limits
        </ConfirmButton>
        <ConfirmButton
          disabled={mutation.isPending || !settings || reason.trim().length < 3}
          title="Use the .env limits?"
          description="Both coins go back to PAYMENT_MIN_* / PAYMENT_MAX_* from the server environment."
          confirmLabel="Use .env"
          onConfirm={() =>
            mutation.mutate({ paymentLimits: { usdc: null, usdt: null }, note: reason.trim() })
          }
        >
          Use .env values
        </ConfirmButton>
      </div>
    </Panel>
  );
}
