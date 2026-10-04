/**
 * Admin-editable business settings over .env defaults, against an in-memory
 * database. No network access.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", async () => {
  const { createFakeSupabase } = await import("./support/fake-supabase");
  return { supabaseAdmin: createFakeSupabase() };
});

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  clearBusinessSettingsCache,
  getBusinessSettings,
  resolveBusinessSettings,
  updateBusinessSettings,
} from "@/lib/business-settings.server";

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const KEYS = [
  "LAMPORTPAY_FEE_BPS",
  "LAMPORTPAY_SWAP_FEE_BPS",
  "LAMPORTPAY_REVENUE_WALLET",
  "PAYMENT_ENABLED_CURRENCIES",
];
const saved = { ...process.env };

function row(overrides: Record<string, unknown> = {}) {
  return {
    conversion_fee_bps: null,
    swap_fee_bps: null,
    revenue_wallet: null,
    enabled_currencies: null,
    updated_at: "2026-09-30T00:00:00Z",
    updated_by: null,
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of KEYS) delete process.env[key];
  clearBusinessSettingsCache();
  (supabaseAdmin as unknown as { reset: () => void }).reset();
});
afterEach(() => {
  process.env = { ...saved };
});

describe("resolveBusinessSettings", () => {
  it("falls back to .env, and to no fee and both coins when .env is empty", () => {
    const s = resolveBusinessSettings(null);
    expect(s).toMatchObject({
      conversionFeeBps: 0,
      swapFeeBps: 0,
      revenueWallet: null,
      enabledCurrencies: ["usdc", "usdt"],
    });
    expect(s.sources.conversionFeeBps).toBe("env");
  });

  it("reads USDC-only and the one 2% LamportPay fee from .env", () => {
    process.env["LAMPORTPAY_FEE_BPS"] = "200";
    process.env["LAMPORTPAY_SWAP_FEE_BPS"] = "0";
    process.env["LAMPORTPAY_REVENUE_WALLET"] = WALLET;
    process.env["PAYMENT_ENABLED_CURRENCIES"] = "usdc";
    expect(resolveBusinessSettings(null)).toMatchObject({
      conversionFeeBps: 200,
      swapFeeBps: 0,
      revenueWallet: WALLET,
      enabledCurrencies: ["usdc"],
    });
  });

  it("lets admin values override .env", () => {
    process.env["LAMPORTPAY_FEE_BPS"] = "200";
    process.env["LAMPORTPAY_REVENUE_WALLET"] = WALLET;
    const s = resolveBusinessSettings(
      row({ conversion_fee_bps: 150, revenue_wallet: OTHER, enabled_currencies: ["usdc"] }),
    );
    expect(s).toMatchObject({ conversionFeeBps: 150, revenueWallet: OTHER });
    expect(s.enabledCurrencies).toEqual(["usdc"]);
    expect(s.sources).toMatchObject({ conversionFeeBps: "admin", swapFeeBps: "env" });
  });

  it("refuses a fee without a wallet, bad swap fees and unknown coins", () => {
    expect(() => resolveBusinessSettings(row({ conversion_fee_bps: 200 }))).toThrow(
      /no revenue wallet/,
    );
    expect(() => resolveBusinessSettings(row({ swap_fee_bps: 30 }))).toThrow(/between 50 and 255/);
    // One total fee: a separate swap fee is never allowed (2% + 2% would be 4%).
    expect(() => resolveBusinessSettings(row({ swap_fee_bps: 200 }))).toThrow(/one total fee/);
    process.env["LAMPORTPAY_SWAP_FEE_BPS"] = "200";
    expect(() => resolveBusinessSettings(null)).toThrow(/one total fee/);
    delete process.env["LAMPORTPAY_SWAP_FEE_BPS"];
    expect(() => resolveBusinessSettings(row({ enabled_currencies: ["dai"] }))).toThrow(/unknown/);
    expect(() => resolveBusinessSettings(row({ enabled_currencies: [] }))).toThrow(/at least one/);
    expect(() => resolveBusinessSettings(row({ revenue_wallet: "0xabc" }))).toThrow(
      /valid Solana address/,
    );
    process.env["PAYMENT_ENABLED_CURRENCIES"] = "usdc,usdx";
    expect(() => resolveBusinessSettings(null)).toThrow(/usdx/);
  });
});

describe("updateBusinessSettings", () => {
  it("stores an admin change and returns before and after", async () => {
    const { before, after } = await updateBusinessSettings(
      { conversionFeeBps: 200, revenueWallet: WALLET, enabledCurrencies: ["usdc"] },
      ADMIN,
    );
    expect(before.conversionFeeBps).toBe(0);
    expect(after).toMatchObject({ conversionFeeBps: 200, revenueWallet: WALLET });
    const read = await getBusinessSettings();
    expect(read.enabledCurrencies).toEqual(["usdc"]);
    expect(read.updatedBy).toBe(ADMIN);
  });

  it("changes only what the patch names, and null returns to .env", async () => {
    await updateBusinessSettings({ conversionFeeBps: 200, revenueWallet: WALLET }, ADMIN);
    await updateBusinessSettings({ revenueWallet: OTHER }, ADMIN);
    let s = await getBusinessSettings();
    expect(s).toMatchObject({ conversionFeeBps: 200, revenueWallet: OTHER, swapFeeBps: 0 });

    await updateBusinessSettings({ conversionFeeBps: null, revenueWallet: null }, ADMIN);
    s = await getBusinessSettings();
    expect(s).toMatchObject({ conversionFeeBps: 0, revenueWallet: null });
    expect(s.sources.revenueWallet).toBe("env");
  });

  it("refuses an invalid combination and writes nothing", async () => {
    await expect(updateBusinessSettings({ conversionFeeBps: 200 }, ADMIN)).rejects.toThrow(
      /no revenue wallet/,
    );
    const s = await getBusinessSettings();
    expect(s.conversionFeeBps).toBe(0);
    await updateBusinessSettings({ conversionFeeBps: 200, revenueWallet: WALLET }, ADMIN);
    // Removing the wallet while a fee is set is refused too.
    await expect(updateBusinessSettings({ revenueWallet: null }, ADMIN)).rejects.toThrow(
      /no revenue wallet/,
    );
  });
});
