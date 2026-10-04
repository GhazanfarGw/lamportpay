import { describe, expect, it } from "vitest";

import { COUNTRY_CURRENCY, payoutCurrencyFor } from "@/lib/country-currency";
import {
  lamportpayFeeMinor,
  maxConvertibleMinor,
  percentageModel,
  splitTotal,
} from "@/lib/payments/fee-math";
import { conversionFeeMinor } from "@/lib/payments/fees.server";
import { holdingsView } from "@/lib/payments/wallet-holdings.server";

const USDC = 1_000_000n;

describe("shared fee math", () => {
  it("matches the server's conversion fee exactly (rounded up)", () => {
    for (const amount of [0n, 1n, 49n, 50n, 99n, 100n * USDC, 980_392_156n, 123_456_789n]) {
      for (const bps of [0n, 1n, 150n, 200n, 1000n]) {
        expect(lamportpayFeeMinor(amount, bps)).toBe(conversionFeeMinor(amount, bps));
      }
    }
  });

  it("1,000 USDC sent at 2%: 980 converted, fee 20, total exactly 1,000", () => {
    const max = maxConvertibleMinor(1000n * USDC, 200n);
    expect(max).toBe(980n * USDC);
    expect(lamportpayFeeMinor(max, 200n)).toBe(20n * USDC);
    expect(max + lamportpayFeeMinor(max, 200n)).toBe(1000n * USDC);
    expect(splitTotal(150n * USDC, percentageModel(200n))).toEqual({
      netMinor: 147n * USDC,
      feeMinor: 3n * USDC,
      rule: "percentage",
    });
  });

  it("max is the largest amount whose total fits the balance, for many balances", () => {
    for (const balance of [1n, 2n, 51n, 101n, 999_999n, 100n * USDC + 7n, 1_234_567_891n]) {
      for (const bps of [1n, 200n, 999n]) {
        const max = maxConvertibleMinor(balance, bps);
        expect(max + lamportpayFeeMinor(max, bps)).toBeLessThanOrEqual(balance);
        expect(max + 1n + lamportpayFeeMinor(max + 1n, bps)).toBeGreaterThan(balance);
      }
    }
  });

  it("with no fee the whole balance converts; an empty balance converts nothing", () => {
    expect(maxConvertibleMinor(500n * USDC, 0n)).toBe(500n * USDC);
    expect(maxConvertibleMinor(0n, 200n)).toBe(0n);
  });
});

describe("country → payout currency", () => {
  const iso = new Set(Intl.supportedValuesOf("currency"));

  it("maps only valid ISO 3166 regions to valid ISO 4217 currencies", () => {
    for (const [country, currency] of Object.entries(COUNTRY_CURRENCY)) {
      expect(country).toMatch(/^[A-Z]{2}$/);
      expect(Intl.getCanonicalLocales(`und-${country}`)[0]).toBe(`und-${country}`);
      expect(iso.has(currency), `${country} → ${currency}`).toBe(true);
    }
  });

  it("derives the examples from the brief", () => {
    expect(payoutCurrencyFor("AU")).toBe("AUD");
    expect(payoutCurrencyFor("gb")).toBe("GBP");
    expect(payoutCurrencyFor("NG")).toBe("NGN");
    expect(payoutCurrencyFor("SA")).toBe("SAR");
    expect(payoutCurrencyFor("DE")).toBe("EUR");
    expect(payoutCurrencyFor("ZZ")).toBeNull();
  });
});

describe("wallet holdings view", () => {
  const settings = {
    conversionFeeBps: 200,
    feeMin: null,
    feeMax: null,
    enabledCurrencies: ["usdc" as const],
  };

  it("shows real balances of enabled coins only, and the max after the fee", () => {
    const view = holdingsView(
      {
        status: "ok",
        owner: "W",
        slot: 1,
        readAt: "2026-10-01T00:00:00.000Z",
        solLamports: 1_500_000_000n,
        tokens: { usdc: 1000n * USDC, usdt: 5n * USDC },
      },
      settings,
    );
    expect(view).toEqual({
      status: "ok",
      wallet: "W",
      readAt: "2026-10-01T00:00:00.000Z",
      sol: "1.5",
      tokens: { usdc: "1000" },
      maxConvertible: { usdc: "980" },
      feeBps: 200,
      feeMin: null,
      feeMax: null,
    });
  });

  it("never turns a failed read into a zero balance", () => {
    const view = holdingsView({ status: "unavailable", owner: "W", reason: "rpc down" }, settings);
    expect(view.status).toBe("unavailable");
    expect(view).not.toHaveProperty("tokens");
  });
});
