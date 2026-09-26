import { describe, expect, it } from "vitest";

import { currencyExponent, formatMinor, toMajor, toMinor } from "@/lib/money";

describe("toMinor", () => {
  it("parses major-unit strings into integer minor units", () => {
    expect(toMinor("100", "usdc")).toBe(100_000_000n);
    expect(toMinor("100.5", "USDC")).toBe(100_500_000n);
    expect(toMinor("0.000001", "usdc")).toBe(1n);
    expect(toMinor("133.52", "aud")).toBe(13_352n);
    expect(toMinor("2500", "ugx")).toBe(2_500n);
  });

  it("never goes through floating point", () => {
    expect(toMinor("0.1", "usd") + toMinor("0.2", "usd")).toBe(toMinor("0.3", "usd"));
    expect(toMinor("9007199254740993.123456", "usdc")).toBe(9_007_199_254_740_993_123_456n);
  });

  it("accepts insignificant extra zeros but rejects extra precision in strict mode", () => {
    expect(toMinor("1.500", "usd")).toBe(150n);
    expect(() => toMinor("1.005", "usd")).toThrow(/decimal places/);
    expect(() => toMinor("1.5", "vnd")).toThrow(/decimal places/);
  });

  it("rounds half-up in round mode", () => {
    expect(toMinor("1.005", "usd", "round")).toBe(101n);
    expect(toMinor("1.004", "usd", "round")).toBe(100n);
    expect(toMinor("0.199", "usd", "round")).toBe(20n);
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "-1", "1e3", "1,000", ".5", "5.", "abc", "NaN"]) {
      expect(() => toMinor(bad, "usd"), bad).toThrow(/Invalid decimal/);
    }
    expect(() => toMinor("1", "xyz")).toThrow(/Unknown currency/);
  });
});

describe("toMajor", () => {
  it("formats minor units as Stables-compatible decimal strings", () => {
    expect(toMajor(100_000_000n, "usdc")).toBe("100");
    expect(toMajor(100_500_000n, "usdc")).toBe("100.5");
    expect(toMajor(1n, "usdc")).toBe("0.000001");
    expect(toMajor(13_352n, "aud")).toBe("133.52");
    expect(toMajor(0n, "usd")).toBe("0");
    expect(toMajor(2_500n, "ugx")).toBe("2500");
  });

  it("round-trips with toMinor", () => {
    for (const minor of [0n, 1n, 99n, 100n, 123_456_789n]) {
      expect(toMinor(toMajor(minor, "usdc"), "usdc")).toBe(minor);
      expect(toMinor(toMajor(minor, "inr"), "inr")).toBe(minor);
    }
    expect(toMajor(toMinor("100.50", "usd"), "usd")).toMatch(/^\d+(\.\d+)?$/);
  });

  it("rejects negative amounts", () => {
    expect(() => toMajor(-1n, "usd")).toThrow();
  });
});

describe("formatMinor", () => {
  it("groups thousands and shows at least two decimals", () => {
    expect(formatMinor(123_456_789n, "usd")).toBe("1,234,567.89");
    expect(formatMinor(100_000_000n, "usdc")).toBe("100.00");
    expect(formatMinor(100_123_400n, "usdc")).toBe("100.1234");
    expect(formatMinor(1_500_000n, "vnd")).toBe("1,500,000");
  });
});

describe("currencyExponent", () => {
  it("knows stablecoin and fiat exponents", () => {
    expect(currencyExponent("USDC")).toBe(6);
    expect(currencyExponent("usdt")).toBe(6);
    expect(currencyExponent("INR")).toBe(2);
    expect(currencyExponent("XOF")).toBe(0);
  });

  it("falls back to ISO 4217 digits for currencies not listed", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("bhd")).toBe(3);
    expect(currencyExponent("CHF")).toBe(2);
    expect(toMinor("12.345", "kwd")).toBe(12345n);
    expect(() => currencyExponent("abc")).toThrow(/Unknown currency/);
  });
});
