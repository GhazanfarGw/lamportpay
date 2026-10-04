/**
 * C05: configurable fee models. LamportPay still charges ONE fee per payment;
 * the model only decides its amount (percentage, optional minimum/maximum, or
 * fixed). The approved default — plain 2% — must be unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", async () => {
  const { createFakeSupabase } = await import("./support/fake-supabase");
  return { supabaseAdmin: createFakeSupabase() };
});

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  clearBusinessSettingsCache,
  feeModelLabel,
  feeModelOf,
  getBusinessSettings,
  resolveBusinessSettings,
  updateBusinessSettings,
} from "@/lib/business-settings.server";
import {
  chargesFee,
  maxConvertibleFor,
  percentageModel,
  platformFee,
  platformFeeMinor,
  type FeeModel,
} from "@/lib/payments/fee-math";
import { pricingSnapshot } from "@/lib/payments/fee-ledger.server";
import { conversionFeeMinor } from "@/lib/payments/fees.server";

const U = 1_000_000n; // 1 USDC in minor units
const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const saved = { ...process.env };

beforeEach(() => {
  clearBusinessSettingsCache();
  (supabaseAdmin as unknown as { reset: () => void }).reset();
});
afterEach(() => {
  process.env = { ...saved };
  delete process.env["LAMPORTPAY_FEE_BPS"];
  delete process.env["LAMPORTPAY_FEE_MIN"];
  delete process.env["LAMPORTPAY_FEE_MAX"];
  delete process.env["LAMPORTPAY_REVENUE_WALLET"];
});

describe("fee model arithmetic", () => {
  const twoPct = percentageModel(200n);
  const bounded: FeeModel = { bps: 200n, minMinor: 3n * U, maxMinor: 50n * U };

  it("plain 2% is unchanged and matches the server's conversion fee", () => {
    for (const amount of [1n, 100n * U, 75n * U, 123_456_789n]) {
      expect(platformFeeMinor(amount, twoPct)).toBe(conversionFeeMinor(amount, 200n));
    }
    // 2% of what is sent: 980 to the partner + 20 fee = 1,000 sent.
    expect(platformFee(980n * U, twoPct)).toEqual({ minor: 20n * U, rule: "percentage" });
  });

  it("applies the minimum on small payments and the maximum on large ones", () => {
    expect(platformFee(100n * U, bounded)).toEqual({ minor: 3n * U, rule: "minimum" });
    expect(platformFee(980n * U, bounded)).toEqual({ minor: 20n * U, rule: "percentage" });
    expect(platformFee(10_000n * U, bounded)).toEqual({ minor: 50n * U, rule: "maximum" });
  });

  it("supports a fixed fee (0% with min = max) and no fee at all", () => {
    const fixed: FeeModel = { bps: 0n, minMinor: 5n * U, maxMinor: 5n * U };
    expect(chargesFee(fixed)).toBe(true);
    expect(platformFee(100n * U, fixed)).toEqual({ minor: 5n * U, rule: "minimum" });
    expect(platformFee(900_000n * U, fixed).minor).toBe(5n * U);
    const off: FeeModel = { bps: 0n, minMinor: null, maxMinor: 7n * U };
    expect(chargesFee(off)).toBe(false);
    expect(platformFee(100n * U, off)).toEqual({ minor: 0n, rule: "none" });
    expect(platformFee(0n, bounded)).toEqual({ minor: 0n, rule: "none" });
  });

  it("Max stays exact under any model: the largest amount whose total fits", () => {
    for (const model of [twoPct, bounded, { bps: 0n, minMinor: 5n * U, maxMinor: 5n * U }]) {
      for (const balance of [1n, 4n * U, 103n * U, 1000n * U, 2551n * U + 7n, 99_999n * U]) {
        const max = maxConvertibleFor(balance, model);
        expect(max + platformFeeMinor(max, model)).toBeLessThanOrEqual(balance);
        expect(max + 1n + platformFeeMinor(max + 1n, model)).toBeGreaterThan(balance);
      }
    }
    // Sending 1,000 USDC at 2%: 980 to the partner, 20 fee (fee comes out of the total).
    expect(maxConvertibleFor(1000n * U, twoPct)).toBe(980n * U);
  });
});

describe("fee model settings", () => {
  it("defaults to no bounds, so the approved 2% model is untouched", () => {
    process.env["LAMPORTPAY_FEE_BPS"] = "200";
    process.env["LAMPORTPAY_REVENUE_WALLET"] = WALLET;
    const s = resolveBusinessSettings(null);
    expect(s).toMatchObject({ conversionFeeBps: 200, feeMin: null, feeMax: null });
    expect(feeModelOf(s)).toEqual(percentageModel(200n));
    expect(feeModelLabel(s)).toBe("2%");
  });

  it("reads bounds from .env, and admin values override (0 = explicitly none)", () => {
    process.env["LAMPORTPAY_FEE_BPS"] = "200";
    process.env["LAMPORTPAY_FEE_MIN"] = "3";
    process.env["LAMPORTPAY_FEE_MAX"] = "none";
    process.env["LAMPORTPAY_REVENUE_WALLET"] = WALLET;
    const env = resolveBusinessSettings(null);
    expect(env).toMatchObject({ feeMin: "3", feeMax: null });
    expect(env.sources).toMatchObject({ feeMin: "env", feeMax: "env" });
    expect(feeModelLabel(env)).toBe("2% (min 3)");

    const admin = resolveBusinessSettings({
      conversion_fee_bps: null,
      platform_fee_min_minor: 0,
      platform_fee_max_minor: 25_500_000,
      swap_fee_bps: null,
      revenue_wallet: null,
      enabled_currencies: null,
      updated_at: "2026-10-01T00:00:00Z",
      updated_by: ADMIN,
    });
    expect(admin).toMatchObject({ feeMin: null, feeMax: "25.5" });
    expect(admin.sources).toMatchObject({ feeMin: "admin", feeMax: "admin" });
  });

  it("refuses a minimum above the maximum, and any fee without a revenue wallet", () => {
    process.env["LAMPORTPAY_FEE_BPS"] = "200";
    process.env["LAMPORTPAY_REVENUE_WALLET"] = WALLET;
    process.env["LAMPORTPAY_FEE_MIN"] = "10";
    process.env["LAMPORTPAY_FEE_MAX"] = "5";
    expect(() => resolveBusinessSettings(null)).toThrow(/minimum .* above the maximum/);

    // A fixed fee (0% with a minimum) still needs somewhere to go.
    delete process.env["LAMPORTPAY_FEE_MAX"];
    process.env["LAMPORTPAY_FEE_BPS"] = "0";
    delete process.env["LAMPORTPAY_REVENUE_WALLET"];
    expect(() => resolveBusinessSettings(null)).toThrow(/no revenue wallet/);
    process.env["LAMPORTPAY_FEE_MIN"] = "abc";
    expect(() => resolveBusinessSettings(null)).toThrow(/LAMPORTPAY_FEE_MIN/);
  });

  it("an admin can set and clear bounds; invalid combinations are not saved", async () => {
    await updateBusinessSettings(
      { conversionFeeBps: 200, revenueWallet: WALLET, feeMinMinor: 3_000_000 },
      ADMIN,
    );
    expect(await getBusinessSettings()).toMatchObject({ feeMin: "3", feeMax: null });
    await expect(updateBusinessSettings({ feeMaxMinor: 1_000_000 }, ADMIN)).rejects.toThrow(
      /above the maximum/,
    );
    expect(await getBusinessSettings()).toMatchObject({ feeMin: "3", feeMax: null });
    await updateBusinessSettings({ feeMinMinor: null }, ADMIN);
    expect(await getBusinessSettings()).toMatchObject({ feeMin: null });
  });
});

describe("pricing snapshot records the model", () => {
  it("keeps the bounds and the rule that decided the fee, never the wallet address", () => {
    const snap = pricingSnapshot(
      {
        quote_id: "q1",
        source_currency: "usdc",
        source_amount_minor: 100_000_000,
        destination_currency: "gbp",
        destination_country: "GB",
        destination_amount_minor: 7_000,
        exchange_rate: 0.7,
        fees: {},
        platform_fee_bps: 200,
        platform_fee_minor: 3_000_000,
        platform_fee_wallet: WALLET,
        platform_fee_min_minor: 3_000_000,
        platform_fee_max_minor: null,
        platform_fee_rule: "minimum",
      },
      { amountMinor: 100_000_000n, currency: "usdc" },
      "2026-10-01T00:00:00Z",
    );
    expect(snap).toMatchObject({
      lamportpay_fee: {
        bps: 200,
        min_minor: "3000000",
        max_minor: null,
        rule: "minimum",
        amount_minor: "3000000",
      },
      total_minor: "103000000",
    });
    expect(JSON.stringify(snap)).not.toContain(WALLET);
  });
});
