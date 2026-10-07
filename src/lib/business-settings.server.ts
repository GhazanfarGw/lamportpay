/**
 * Business settings an admin can change without a deploy: the LamportPay fee,
 * the revenue wallet and which payment coins are on.
 *
 * Owner decision (2026-09-30): LamportPay charges ONE total fee (2%), never a
 * conversion fee plus a swap fee. The fee is `conversionFeeBps` ("LamportPay
 * fee"), paid once per payment as a separate transfer in the user-signed
 * funding transaction. A separate Jupiter swap fee (`swapFeeBps`) must be 0:
 * any non-zero value is refused, so the customer can never be charged twice. Each value comes from the `business_settings` row when an admin
 * set it, and otherwise from .env (fees.server.ts). Never secrets: the revenue
 * wallet is a public address, and API keys stay in .env only.
 *
 * Read with a short cache so a change reaches payments within seconds. A failed
 * read throws (payments answer 503): charging a stale or default fee would be
 * worse than pausing.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { MODE_PROFILES, type AppMode } from "@/lib/app-mode";
import { currentMode } from "@/lib/app-mode.server";
import type { Json } from "@/integrations/supabase/types";
import { toMajor, toMinor } from "@/lib/money";
import { chargesFee, type FeeModel } from "@/lib/payments/fee-math";
import { getPaymentLimits, limitsFromMinor } from "@/lib/payments/limits.server";
import {
  controlsForMode,
  narrowLimits,
  parseModeControls,
  type ModeControls,
} from "@/lib/payments/controls";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "@/lib/tokens";
import {
  checkSwapBps,
  checkWallet,
  envEnabledCurrencies,
  envFeeBounds,
  getFeeConfig,
  MAX_CONVERSION_FEE_BPS,
  parseEnabledCurrencies,
} from "./payments/fees.server";

/** "test_mode": forced by TEST MODE for as long as it is active (payment limits only). */
export type SettingSource = "admin" | "env" | "test_mode";

export type BusinessSettings = {
  conversionFeeBps: number;
  /**
   * Optional smallest / largest LamportPay fee per payment (C05 fee models), in
   * the payment coin's major units ("1.5"); null = no bound. With both null the
   * fee is the plain percentage (the approved 2% model).
   */
  feeMin: string | null;
  feeMax: string | null;
  swapFeeBps: number;
  /** Public address that receives LamportPay's fee; null when none is set. */
  revenueWallet: string | null;
  enabledCurrencies: PaymentCurrency[];
  /**
   * LamportPay's own per-payment limits per coin (C07), major units; max null =
   * no LamportPay maximum (Stables' limits decide). Admin value, else .env.
   * Null when that coin's limits are misconfigured: payments in it answer 503
   * (limits_misconfigured) while everything else keeps working.
   */
  paymentLimits: Record<PaymentCurrency, { min: string; max: string | null } | null>;
  /**
   * Emergency controls and per-corridor rules for every mode, as stored
   * (lib/payments/controls). Read the active mode's with `activeControls`.
   */
  paymentControls?: Json | null;
  sources: {
    conversionFeeBps: SettingSource;
    feeMin: SettingSource;
    feeMax: SettingSource;
    swapFeeBps: SettingSource;
    revenueWallet: SettingSource;
    enabledCurrencies: SettingSource;
    paymentLimits: Record<PaymentCurrency, SettingSource>;
  };
  updatedAt: string | null;
  updatedBy: string | null;
};

/** What an admin may change. `null` clears the override (back to .env). */
export type BusinessSettingsPatch = {
  conversionFeeBps?: number | null;
  /** Minor units; 0 = explicitly no bound, null = back to .env. */
  feeMinMinor?: number | null;
  feeMaxMinor?: number | null;
  revenueWallet?: string | null;
  enabledCurrencies?: PaymentCurrency[] | null;
  /** Per coin: new limits in minor units, or null to go back to .env. */
  paymentLimits?: Partial<Record<PaymentCurrency, StoredLimit | null>>;
  /** Replace one mode's emergency controls (validated with parseModeControls). */
  paymentControls?: { mode: AppMode; controls: unknown };
};

/** One coin's admin limits, minor units; max_minor null = no LamportPay maximum. */
export type StoredLimit = { min_minor: number; max_minor: number | null };

type StoredRow = {
  conversion_fee_bps: number | null;
  /** 0 = explicitly no bound; null = use .env. */
  platform_fee_min_minor: number | null;
  platform_fee_max_minor: number | null;
  swap_fee_bps: number | null;
  revenue_wallet: string | null;
  enabled_currencies: string[] | null;
  payment_limits?: Partial<Record<PaymentCurrency, StoredLimit>> | null;
  payment_controls?: Json | null;
  updated_at: string;
  updated_by: string | null;
};

const CACHE_MS = 10_000;
let cache: { at: number; value: BusinessSettings } | null = null;

export function clearBusinessSettingsCache(): void {
  cache = null;
}

function checkConversionBps(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_CONVERSION_FEE_BPS) {
    throw new Error(
      `${label} must be a whole number from 0 to ${MAX_CONVERSION_FEE_BPS} basis points.`,
    );
  }
  return value;
}

/** Merge the stored overrides over the .env defaults, and check the result. Pure. */
export function resolveBusinessSettings(row: StoredRow | null): BusinessSettings {
  const env = getFeeConfig();
  const pick = <T>(stored: T | null | undefined, fallback: T): [T, SettingSource] =>
    stored === null || stored === undefined ? [fallback, "env"] : [stored, "admin"];

  const [conversionFeeBps, conversionSource] = pick(
    row?.conversion_fee_bps,
    Number(env.conversionBps),
  );
  const envBounds = envFeeBounds();
  const bound = (stored: number | null | undefined, fallback: bigint | null) => {
    const [value, source] = pick<bigint | null>(
      stored === null || stored === undefined ? undefined : BigInt(stored),
      fallback,
    );
    return [value !== null && value > 0n ? value : null, source] as const;
  };
  const [feeMinMinor, feeMinSource] = bound(row?.platform_fee_min_minor, envBounds.minMinor);
  const [feeMaxMinor, feeMaxSource] = bound(row?.platform_fee_max_minor, envBounds.maxMinor);
  if (feeMinMinor !== null && feeMaxMinor !== null && feeMinMinor > feeMaxMinor) {
    throw new Error("The minimum LamportPay fee is above the maximum.");
  }
  const [swapFeeBps, swapSource] = pick(row?.swap_fee_bps, env.swapBps);
  const [revenueWallet, walletSource] = pick(row?.revenue_wallet, env.revenueWallet);
  const [currencies, currencySource] = pick<readonly string[]>(
    row?.enabled_currencies,
    envEnabledCurrencies(),
  );

  if (checkSwapBps(swapFeeBps, "Swap fee") !== 0) {
    throw new Error(
      "LamportPay charges one total fee: a separate swap fee is not allowed. Set LAMPORTPAY_SWAP_FEE_BPS to 0 (or remove it).",
    );
  }
  const paymentLimits = {} as BusinessSettings["paymentLimits"];
  const limitSources = {} as Record<PaymentCurrency, SettingSource>;
  for (const coin of PAYMENT_CURRENCIES) {
    const stored = row?.payment_limits?.[coin];
    limitSources[coin] = stored ? "admin" : "env";
    try {
      const limits = stored
        ? limitsFromMinor(
            BigInt(stored.min_minor),
            stored.max_minor === null ? null : BigInt(stored.max_minor),
            coin,
          )
        : getPaymentLimits(coin);
      paymentLimits[coin] = { min: limits.min, max: limits.max };
    } catch (e) {
      console.error("[settings] invalid payment limits:", e instanceof Error ? e.message : e);
      paymentLimits[coin] = null;
    }
  }

  const settings: BusinessSettings = {
    conversionFeeBps: checkConversionBps(conversionFeeBps, "LamportPay fee"),
    feeMin: feeMinMinor === null ? null : toMajor(feeMinMinor, "usdc"),
    feeMax: feeMaxMinor === null ? null : toMajor(feeMaxMinor, "usdc"),
    swapFeeBps: 0,
    revenueWallet: revenueWallet ? checkWallet(revenueWallet, "Revenue wallet") : null,
    enabledCurrencies: parseEnabledCurrencies(currencies, "Payment coins"),
    paymentLimits,
    paymentControls: row?.payment_controls ?? null,
    sources: {
      conversionFeeBps: conversionSource,
      feeMin: feeMinSource,
      feeMax: feeMaxSource,
      swapFeeBps: swapSource,
      revenueWallet: walletSource,
      enabledCurrencies: currencySource,
      paymentLimits: limitSources,
    },
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  };
  if (chargesFee(feeModelOf(settings)) && !settings.revenueWallet) {
    throw new Error("A LamportPay fee is set but no revenue wallet is.");
  }
  return settings;
}

async function readRow(): Promise<StoredRow | null> {
  const { data, error } = await supabaseAdmin
    .from("business_settings")
    .select(
      "conversion_fee_bps, platform_fee_min_minor, platform_fee_max_minor, swap_fee_bps, revenue_wallet, enabled_currencies, payment_limits, payment_controls, updated_at, updated_by",
    )
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(`Could not read business settings: ${error.message}`);
  return (data as StoredRow | null) ?? null;
}

/** The effective settings. Throws when they cannot be read or are invalid. */
export async function getBusinessSettings(): Promise<BusinessSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return withModeLimits(cache.value);
  const value = resolveBusinessSettings(await readRow());
  cache = { at: Date.now(), value };
  return withModeLimits(value);
}

/**
 * The mode's own limits (TEST MODE: 1–5,000 USDC) replace the business limits
 * while that mode is active. Applied on read only: the stored settings and the
 * LIVE limits are never changed. Every server path (estimate, quote, payment)
 * reads limits through getBusinessSettings, so the test limit is server-enforced.
 */
export function withModeLimits(
  settings: BusinessSettings,
  mode: AppMode = currentMode().mode,
): BusinessSettings {
  const forced = MODE_PROFILES[mode].paymentLimits;
  if (!forced) return settings;
  return {
    ...settings,
    paymentLimits: { ...forced },
    sources: {
      ...settings.sources,
      paymentLimits: Object.fromEntries(
        PAYMENT_CURRENCIES.map((c) => [c, "test_mode" as const]),
      ) as Record<PaymentCurrency, SettingSource>,
    },
  };
}

/**
 * Apply an admin's change (the caller has checked the admin role). The merged
 * result is validated before anything is written, so an invalid combination
 * (a fee without a revenue wallet, no coin turned on) is refused whole.
 * Returns the settings before and after, for the audit log.
 */
export async function updateBusinessSettings(
  patch: BusinessSettingsPatch,
  actorId: string,
): Promise<{ before: BusinessSettings; after: BusinessSettings }> {
  const current = await readRow();
  const before = resolveBusinessSettings(current);
  const next: StoredRow = {
    conversion_fee_bps: current?.conversion_fee_bps ?? null,
    platform_fee_min_minor: current?.platform_fee_min_minor ?? null,
    platform_fee_max_minor: current?.platform_fee_max_minor ?? null,
    swap_fee_bps: current?.swap_fee_bps ?? null,
    revenue_wallet: current?.revenue_wallet ?? null,
    enabled_currencies: current?.enabled_currencies ?? null,
    payment_limits: current?.payment_limits ?? null,
    payment_controls: current?.payment_controls ?? null,
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  };
  if (patch.conversionFeeBps !== undefined) next.conversion_fee_bps = patch.conversionFeeBps;
  if (patch.feeMinMinor !== undefined) next.platform_fee_min_minor = patch.feeMinMinor;
  if (patch.feeMaxMinor !== undefined) next.platform_fee_max_minor = patch.feeMaxMinor;
  if (patch.revenueWallet !== undefined) {
    next.revenue_wallet = patch.revenueWallet?.trim() || null;
  }
  if (patch.enabledCurrencies !== undefined) next.enabled_currencies = patch.enabledCurrencies;
  if (patch.paymentLimits !== undefined) {
    const merged: Partial<Record<PaymentCurrency, StoredLimit>> = {
      ...(next.payment_limits ?? {}),
    };
    for (const [coin, value] of Object.entries(patch.paymentLimits) as [
      PaymentCurrency,
      StoredLimit | null,
    ][]) {
      if (value === null) delete merged[coin];
      else merged[coin] = { min_minor: value.min_minor, max_minor: value.max_minor };
    }
    next.payment_limits = Object.keys(merged).length > 0 ? merged : null;
  }

  if (patch.paymentControls !== undefined) {
    const { mode, controls } = patch.paymentControls;
    const existing =
      next.payment_controls &&
      typeof next.payment_controls === "object" &&
      !Array.isArray(next.payment_controls)
        ? (next.payment_controls as Record<string, Json>)
        : {};
    next.payment_controls = {
      ...existing,
      [mode]: parseModeControls(controls) as unknown as Json, // throws on invalid controls
    };
  }

  const after = resolveBusinessSettings(next); // throws on an invalid combination
  if (patch.paymentLimits) {
    for (const [coin, value] of Object.entries(patch.paymentLimits)) {
      if (value) {
        limitsFromMinor(
          BigInt(value.min_minor),
          value.max_minor === null ? null : BigInt(value.max_minor),
          coin as PaymentCurrency,
        ); // throws: an admin can't save limits that would pause payments
      }
    }
  }
  const { error } = await supabaseAdmin.from("business_settings").upsert(
    {
      id: true,
      ...next,
      payment_limits: (next.payment_limits ?? null) as Json,
      payment_controls: (next.payment_controls ?? null) as Json,
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`Could not save business settings: ${error.message}`);
  clearBusinessSettingsCache();
  return { before, after };
}

/** The fee model the settings describe (minor units of the payment coin). */
export function feeModelOf(
  settings: Pick<BusinessSettings, "conversionFeeBps" | "feeMin" | "feeMax">,
): FeeModel {
  const minor = (major: string | null) => (major === null ? null : toMinor(major, "usdc"));
  return {
    bps: BigInt(settings.conversionFeeBps),
    minMinor: minor(settings.feeMin),
    maxMinor: minor(settings.feeMax),
  };
}

/** One line for admins and the audit log: "2%", "2% (min 1, max 50)", "fixed 3". */
export function feeModelLabel(
  settings: Pick<BusinessSettings, "conversionFeeBps" | "feeMin" | "feeMax">,
): string {
  const { conversionFeeBps: bps, feeMin: min, feeMax: max } = settings;
  if (bps === 0 && min !== null && min === max) return `fixed ${min}`;
  if (bps === 0 && min === null) return "none";
  const bounds = [min !== null && `min ${min}`, max !== null && `max ${max}`].filter(Boolean);
  return `${bpsLabel(bps)}${bounds.length ? ` (${bounds.join(", ")})` : ""}`;
}

/** Human-readable percentage of a basis-point value (200 -> "2%"). */
export function bpsLabel(bps: number): string {
  return `${(bps / 100).toString()}%`;
}

/** The active mode's emergency controls (invalid stored controls fail closed: paused). */
export function activeControls(
  settings: Pick<BusinessSettings, "paymentControls">,
  mode: AppMode = currentMode().mode,
): ModeControls {
  return controlsForMode(settings.paymentControls ?? null, mode);
}

/**
 * Per-coin limits for one payout currency: the effective coin limits (mode
 * limits in TEST MODE) narrowed by that corridor's rule in the active mode.
 */
export function limitsForCorridor(
  settings: Pick<BusinessSettings, "paymentLimits" | "paymentControls">,
  currency: string,
  mode: AppMode = currentMode().mode,
): BusinessSettings["paymentLimits"] {
  const rule = activeControls(settings, mode).corridors[currency.trim().toUpperCase()];
  if (!rule) return settings.paymentLimits;
  const out = {} as BusinessSettings["paymentLimits"];
  for (const coin of PAYMENT_CURRENCIES) {
    out[coin] = narrowLimits(settings.paymentLimits[coin], rule, (minor) =>
      toMajor(BigInt(minor), coin),
    );
  }
  return out;
}
