/**
 * Business settings an admin can change without a deploy: LamportPay's
 * conversion fee, the Jupiter swap fee, the revenue wallet and which payment
 * coins are on. Each value comes from the `business_settings` row when an admin
 * set it, and otherwise from .env (fees.server.ts). Never secrets: the revenue
 * wallet is a public address, and API keys stay in .env only.
 *
 * Read with a short cache so a change reaches payments within seconds. A failed
 * read throws (payments answer 503): charging a stale or default fee would be
 * worse than pausing.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { PaymentCurrency } from "@/lib/tokens";
import {
  checkSwapBps,
  checkWallet,
  envEnabledCurrencies,
  getFeeConfig,
  MAX_CONVERSION_FEE_BPS,
  parseEnabledCurrencies,
} from "./payments/fees.server";

export type SettingSource = "admin" | "env";

export type BusinessSettings = {
  conversionFeeBps: number;
  swapFeeBps: number;
  /** Public address that receives LamportPay's fee; null when none is set. */
  revenueWallet: string | null;
  enabledCurrencies: PaymentCurrency[];
  sources: {
    conversionFeeBps: SettingSource;
    swapFeeBps: SettingSource;
    revenueWallet: SettingSource;
    enabledCurrencies: SettingSource;
  };
  updatedAt: string | null;
  updatedBy: string | null;
};

/** What an admin may change. `null` clears the override (back to .env). */
export type BusinessSettingsPatch = {
  conversionFeeBps?: number | null;
  swapFeeBps?: number | null;
  revenueWallet?: string | null;
  enabledCurrencies?: PaymentCurrency[] | null;
};

type StoredRow = {
  conversion_fee_bps: number | null;
  swap_fee_bps: number | null;
  revenue_wallet: string | null;
  enabled_currencies: string[] | null;
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
  const [swapFeeBps, swapSource] = pick(row?.swap_fee_bps, env.swapBps);
  const [revenueWallet, walletSource] = pick(row?.revenue_wallet, env.revenueWallet);
  const [currencies, currencySource] = pick<readonly string[]>(
    row?.enabled_currencies,
    envEnabledCurrencies(),
  );

  const settings: BusinessSettings = {
    conversionFeeBps: checkConversionBps(conversionFeeBps, "Conversion fee"),
    swapFeeBps: checkSwapBps(swapFeeBps, "Swap fee"),
    revenueWallet: revenueWallet ? checkWallet(revenueWallet, "Revenue wallet") : null,
    enabledCurrencies: parseEnabledCurrencies(currencies, "Payment coins"),
    sources: {
      conversionFeeBps: conversionSource,
      swapFeeBps: swapSource,
      revenueWallet: walletSource,
      enabledCurrencies: currencySource,
    },
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  };
  if (settings.conversionFeeBps > 0 && !settings.revenueWallet) {
    throw new Error("A conversion fee is set but no revenue wallet is.");
  }
  return settings;
}

async function readRow(): Promise<StoredRow | null> {
  const { data, error } = await supabaseAdmin
    .from("business_settings")
    .select(
      "conversion_fee_bps, swap_fee_bps, revenue_wallet, enabled_currencies, updated_at, updated_by",
    )
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(`Could not read business settings: ${error.message}`);
  return (data as StoredRow | null) ?? null;
}

/** The effective settings. Throws when they cannot be read or are invalid. */
export async function getBusinessSettings(): Promise<BusinessSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = resolveBusinessSettings(await readRow());
  cache = { at: Date.now(), value };
  return value;
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
    swap_fee_bps: current?.swap_fee_bps ?? null,
    revenue_wallet: current?.revenue_wallet ?? null,
    enabled_currencies: current?.enabled_currencies ?? null,
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  };
  if (patch.conversionFeeBps !== undefined) next.conversion_fee_bps = patch.conversionFeeBps;
  if (patch.swapFeeBps !== undefined) next.swap_fee_bps = patch.swapFeeBps;
  if (patch.revenueWallet !== undefined) {
    next.revenue_wallet = patch.revenueWallet?.trim() || null;
  }
  if (patch.enabledCurrencies !== undefined) next.enabled_currencies = patch.enabledCurrencies;

  const after = resolveBusinessSettings(next); // throws on an invalid combination
  const { error } = await supabaseAdmin
    .from("business_settings")
    .upsert({ id: true, ...next }, { onConflict: "id" });
  if (error) throw new Error(`Could not save business settings: ${error.message}`);
  clearBusinessSettingsCache();
  return { before, after };
}

/** Human-readable percentage of a basis-point value (200 -> "2%"). */
export function bpsLabel(bps: number): string {
  return `${(bps / 100).toString()}%`;
}
