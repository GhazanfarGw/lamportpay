import { afterEach, describe, expect, it } from "vitest";

import { getPaymentLimits, limitsMessage, outsideLimits } from "@/lib/payments/limits.server";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("payment limits", () => {
  it("defaults to 100 – 1,000,000", () => {
    delete process.env["PAYMENT_MIN_USDC"];
    delete process.env["PAYMENT_MAX_USDC"];
    const limits = getPaymentLimits("usdc");
    expect(limits.min).toBe("100");
    expect(limits.max).toBe("1000000");
    expect(outsideLimits(99_999_999n, limits)).toBe(true);
    expect(outsideLimits(100_000_000n, limits)).toBe(false);
    expect(outsideLimits(1_000_000_000_001n, limits)).toBe(true);
    expect(limitsMessage(limits, "USDC")).toBe("Payments must be between 100 and 1,000,000 USDC.");
  });

  it("'none' removes LamportPay's maximum and keeps the minimum", () => {
    process.env["PAYMENT_MIN_USDT"] = "100";
    process.env["PAYMENT_MAX_USDT"] = "none";
    const limits = getPaymentLimits("usdt");
    expect(limits.maxMinor).toBeNull();
    expect(limits.max).toBeNull();
    expect(outsideLimits(99_000_000n, limits)).toBe(true);
    expect(outsideLimits(50_000_000_000_000n, limits)).toBe(false);
    expect(limitsMessage(limits, "USDT")).toBe("Payments must be at least 100 USDT.");
  });

  it("still rejects an invalid maximum", () => {
    process.env["PAYMENT_MAX_USDC"] = "lots";
    expect(() => getPaymentLimits("usdc")).toThrow(/PAYMENT_MAX_USDC/);
  });
});
