import { afterEach, describe, expect, it } from "vitest";

import { conversionFeeMinor, getFeeConfig, totalToPayMinor } from "@/lib/payments/fees.server";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});
const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

describe("LamportPay fee config", () => {
  it("is off when nothing is configured", () => {
    delete process.env["LAMPORTPAY_FEE_BPS"];
    delete process.env["LAMPORTPAY_SWAP_FEE_BPS"];
    delete process.env["LAMPORTPAY_REVENUE_WALLET"];
    expect(getFeeConfig()).toEqual({ conversionBps: 0n, swapBps: 0, revenueWallet: null });
  });

  it("reads 2% conversion and swap fees with a revenue wallet", () => {
    process.env["LAMPORTPAY_FEE_BPS"] = "200";
    process.env["LAMPORTPAY_SWAP_FEE_BPS"] = "200";
    process.env["LAMPORTPAY_REVENUE_WALLET"] = WALLET;
    expect(getFeeConfig()).toEqual({ conversionBps: 200n, swapBps: 200, revenueWallet: WALLET });
  });

  it("refuses a fee without a revenue wallet, bad wallets and out-of-range values", () => {
    process.env["LAMPORTPAY_FEE_BPS"] = "200";
    delete process.env["LAMPORTPAY_REVENUE_WALLET"];
    expect(() => getFeeConfig()).toThrow(/REVENUE_WALLET/);
    process.env["LAMPORTPAY_REVENUE_WALLET"] = "not-a-wallet";
    expect(() => getFeeConfig()).toThrow(/valid Solana address/);
    process.env["LAMPORTPAY_REVENUE_WALLET"] = WALLET;
    process.env["LAMPORTPAY_FEE_BPS"] = "2%";
    expect(() => getFeeConfig()).toThrow(/basis points/);
    process.env["LAMPORTPAY_FEE_BPS"] = "200";
    process.env["LAMPORTPAY_SWAP_FEE_BPS"] = "300";
    expect(() => getFeeConfig()).toThrow(/at most 255/);
    process.env["LAMPORTPAY_SWAP_FEE_BPS"] = "20";
    expect(() => getFeeConfig()).toThrow(/between 50 and 255/);
  });
});

describe("conversion fee math (6-decimal stablecoins)", () => {
  it("charges 2% on top of the Stables deposit", () => {
    // 100 USDC deposit -> 2 USDC fee -> user pays 102 USDC.
    expect(totalToPayMinor(100_000_000n, 200n)).toEqual({
      depositMinor: 100_000_000n,
      feeMinor: 2_000_000n,
      totalMinor: 102_000_000n,
    });
  });

  it("rounds the fee up to the smallest unit, never down", () => {
    // 2% of 0.000049 USDC = 0.00000098 -> 1 minor unit.
    expect(conversionFeeMinor(49n, 200n)).toBe(1n);
    // 2% of 123.456789 USDC = 2.46913578 -> 2.469136.
    expect(conversionFeeMinor(123_456_789n, 200n)).toBe(2_469_136n);
  });

  it("charges nothing when the fee is off", () => {
    expect(totalToPayMinor(100_000_000n, 0n).feeMinor).toBe(0n);
  });
});
