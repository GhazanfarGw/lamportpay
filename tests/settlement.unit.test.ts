import { describe, expect, it } from "vitest";

import { toMinor } from "@/lib/money";
import {
  classifyPreview,
  decideSettlement,
  isAmountRejection,
  type Candidate,
  type Holdings,
} from "@/lib/payments/settlement";
import type { StablesQuote } from "@/lib/stables/types";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "@/lib/tokens";

const units = (major: string) => toMinor(major, "usdc");
const A = units("150");

const decimals = {
  source: (a: string) => toMinor(a, "usdc"),
  destination: (a: string) => {
    try {
      return toMinor(a, "gbp", "round");
    } catch {
      return null;
    }
  },
  fee: (a: string, c: string) => {
    try {
      return toMinor(a, c, "round");
    } catch {
      return null;
    }
  },
};

function quote(coin: string, dest: string, destAmount: string, fee = "1.25"): StablesQuote {
  return {
    quote_id: `q_${coin}`,
    source: { currency: coin, network: "solana", amount: "150" },
    destination: { currency: dest, network: "bank", amount: destAmount },
    fees: { total_fee: { amount: fee, currency: "usd" } },
    exchange_rate: Number(destAmount) / 150,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    created_at: new Date().toISOString(),
    status: "preview",
  };
}

const priced = (coin: PaymentCurrency, dest: string, destAmount: string, fee?: string) =>
  classifyPreview({
    coin,
    amountMinor: A,
    destinationCurrency: dest,
    decimals,
    quote: quote(coin, dest, destAmount, fee),
  });

const refused = (coin: PaymentCurrency, status: number, code: string, message: string) =>
  classifyPreview({
    coin,
    amountMinor: A,
    destinationCurrency: "usd",
    decimals,
    error: { status, code, message },
  });

const wallet = (usdc: string, usdt: string, sol = 1_000_000_000n): Holdings => ({
  status: "ok",
  solLamports: sol,
  tokens: { usdc: units(usdc), usdt: units(usdt) },
});

const decide = (
  candidates: Candidate[],
  holdings: Holdings,
  extra: { preference?: "auto" | PaymentCurrency; reserve?: bigint | null } = {},
) =>
  decideSettlement({
    amountMinor: A,
    candidates,
    holdings,
    preference: extra.preference ?? "auto",
    solReserveLamports: extra.reserve === undefined ? 5_000_000n : extra.reserve,
    order: PAYMENT_CURRENCIES,
  });

// The 2026-09-27 Stables sandbox answers, as candidates.
const GBP = () => [priced("usdc", "gbp", "111.66"), priced("usdt", "gbp", "112.04")];
const USD = () => [
  priced("usdc", "usd", "142.13"),
  refused(
    "usdt",
    422,
    "ROUTING_ROUTE_NOT_CONFIGURED",
    "No route is currently available for this transfer.",
  ),
];
const EUR = () => [
  refused(
    "usdc",
    422,
    "ROUTING_ROUTE_DISABLED",
    "No route is currently available for this transfer.",
  ),
  refused(
    "usdt",
    422,
    "ROUTING_ROUTE_DISABLED",
    "No route is currently available for this transfer.",
  ),
];
const INR = () => [
  refused("usdc", 422, "ROUTING_QUOTE_FAILED", "This transfer could not be priced right now."),
  refused(
    "usdt",
    422,
    "ROUTING_ROUTE_NOT_CONFIGURED",
    "No route is currently available for this transfer.",
  ),
];

describe("classifyPreview", () => {
  it("prices a quote that matches coin, amount, network and payout currency", () => {
    const c = priced("usdc", "gbp", "111.66");
    expect(c).toMatchObject({ coin: "usdc", verdict: "priced", destinationAmountMinor: 11166n });
    expect(c.verdict === "priced" && c.totalFeeMinor).toBe(125n);
  });

  it("refuses a quote for another coin, amount, network or payout currency", () => {
    const base = { coin: "usdc" as const, amountMinor: A, destinationCurrency: "gbp", decimals };
    const q = quote("usdc", "gbp", "111.66");
    const variants: StablesQuote[] = [
      { ...q, source: { ...q.source, currency: "usdt" } },
      { ...q, source: { ...q.source, amount: "149.99" } },
      { ...q, source: { ...q.source, network: "ethereum" } },
      { ...q, destination: { ...q.destination, currency: "eur" } },
      { ...q, destination: { ...q.destination, amount: "not-a-number" } },
    ];
    for (const v of variants) {
      expect(classifyPreview({ ...base, quote: v }).verdict).toBe("unsupported");
    }
  });

  it("reads Stables errors as verdicts, and never guesses on outages", () => {
    expect(refused("usdc", 422, "ROUTING_ROUTE_DISABLED", "No route").verdict).toBe("unsupported");
    expect(refused("usdc", 422, "ROUTING_QUOTE_FAILED", "could not be priced").verdict).toBe(
      "unavailable",
    );
    expect(refused("usdc", 422, "LIMIT", "Amount exceeds the maximum").verdict).toBe(
      "amount_rejected",
    );
    expect(refused("usdc", 429, "", "Slow down").verdict).toBe("unavailable");
    expect(refused("usdc", 503, "", "Down").verdict).toBe("unavailable");
    expect(refused("usdc", 0, "", "Could not reach Stables.").verdict).toBe("unavailable");
  });

  it("throws on refused credentials instead of calling them a verdict", () => {
    expect(() => refused("usdc", 401, "", "Unauthorized")).toThrow(/credentials/);
    expect(() => refused("usdc", 403, "", "Forbidden")).toThrow(/credentials/);
  });

  it("matches the service's amount-rejection rule", () => {
    expect(isAmountRejection({ status: 422, message: "Amount too high" })).toBe(true);
    expect(isAmountRejection({ status: 429, message: "Amount too high" })).toBe(false);
    expect(isAmountRejection({ status: 422, message: "No route" })).toBe(false);
  });
});

describe("decideSettlement — 2026-09-27 sandbox matrix", () => {
  it("USD payout, wallet holds only USDT: swap into USDC (USDT can't pay out USD)", () => {
    const d = decide(USD(), wallet("0", "500"));
    expect(d).toMatchObject({ kind: "swap_required", coin: "usdc", shortfallMinor: A });
    expect(d.kind === "swap_required" && d.swapInputs.map((i) => i.asset)).toEqual(["sol", "usdt"]);
    expect(d.reason).toMatch(/USDT can't pay out USD/);
  });

  it("GBP payout, both coins held: the better payout wins, no swap", () => {
    const d = decide(GBP(), wallet("500", "500"));
    expect(d).toMatchObject({ kind: "funds_ready", coin: "usdt" });
  });

  it("EUR payout: neither coin is supported", () => {
    expect(decide(EUR(), wallet("500", "500"))).toMatchObject({
      kind: "none_priced",
      error: "destination_not_supported",
    });
  });

  it("INR payout: USDC couldn't be priced right now, so it's 'try again', not 'unsupported'", () => {
    expect(decide(INR(), wallet("500", "0"))).toMatchObject({
      kind: "none_priced",
      error: "quote_unavailable",
    });
  });
});

describe("decideSettlement — rules", () => {
  it("never swaps a coin already held in full, even for a better rate", () => {
    // USDT pays out more, but only USDC is held in full.
    expect(decide(GBP(), wallet("150", "0"))).toMatchObject({ kind: "funds_ready", coin: "usdc" });
  });

  it("treats a balance equal to the amount as enough, one unit less as not", () => {
    expect(decide(GBP(), wallet("150", "0")).kind).toBe("funds_ready");
    const short = decideSettlement({
      amountMinor: A,
      candidates: GBP(),
      holdings: { status: "ok", solLamports: 1_000_000_000n, tokens: { usdc: A - 1n, usdt: 0n } },
      preference: "auto",
      solReserveLamports: 5_000_000n,
      order: PAYMENT_CURRENCIES,
    });
    expect(short).toMatchObject({ kind: "swap_required", coin: "usdc", shortfallMinor: 1n });
  });

  it("needs the amount plus LamportPay's fee in the wallet, and swaps only the difference", () => {
    const fee = A / 50n; // 2%
    const withFee = (usdc: bigint) =>
      decideSettlement({
        amountMinor: A,
        requiredMinor: A + fee,
        candidates: GBP(),
        holdings: { status: "ok", solLamports: 1_000_000_000n, tokens: { usdc, usdt: 0n } },
        preference: "auto",
        solReserveLamports: 5_000_000n,
        order: ["usdc"],
      });
    expect(withFee(A + fee)).toMatchObject({ kind: "funds_ready", coin: "usdc" });
    expect(withFee(A)).toMatchObject({ kind: "swap_required", coin: "usdc", shortfallMinor: fee });
  });

  it("lets a preference pick among held coins, but never cause a swap", () => {
    expect(decide(GBP(), wallet("500", "500"), { preference: "usdc" })).toMatchObject({
      kind: "funds_ready",
      coin: "usdc",
    });
    // Prefers USDT, holds only USDC: pays with USDC, no swap into USDT.
    expect(decide(GBP(), wallet("500", "0"), { preference: "usdt" })).toMatchObject({
      kind: "funds_ready",
      coin: "usdc",
    });
  });

  it("is tentative without a wallet, or when the wallet can't be read", () => {
    expect(decide(GBP(), null)).toMatchObject({ kind: "tentative", coin: "usdt" });
    expect(decide(GBP(), null, { preference: "usdc" })).toMatchObject({
      kind: "tentative",
      coin: "usdc",
    });
    const unreadable = decide(GBP(), { status: "unavailable", reason: "RPC down" });
    expect(unreadable).toMatchObject({ kind: "tentative" });
    expect(unreadable.reason).toMatch(/couldn't read your wallet/);
  });

  it("asks to retry when the coin the user holds is only temporarily unpriced", () => {
    const candidates = [
      priced("usdc", "gbp", "111.66"),
      refused("usdt", 503, "", "Service unavailable"),
    ];
    expect(decide(candidates, wallet("0", "500"))).toMatchObject({
      kind: "retry_later",
      coin: "usdt",
    });
  });

  it("swaps into the coin with the smallest shortfall", () => {
    const d = decide(GBP(), wallet("100", "40"));
    expect(d).toMatchObject({ kind: "swap_required", coin: "usdc", shortfallMinor: units("50") });
  });

  it("reports insufficient funds when there is nothing to swap from", () => {
    expect(decide(GBP(), wallet("0", "0", 5_000_000n))).toMatchObject({
      kind: "insufficient_funds",
    });
  });

  it("asks for SOL first when the fee reserve isn't covered", () => {
    const held = decide(GBP(), wallet("500", "0", 1_000_000n), { reserve: 5_000_000n });
    expect(held).toMatchObject({ kind: "needs_sol", coin: "usdc", solNeededLamports: 4_000_000n });
    // A swap would be needed too, but fees come first; SOL is never swapped for.
    const swap = decide(GBP(), wallet("100", "20", 1_000_000n), { reserve: 5_000_000n });
    expect(swap).toMatchObject({ kind: "needs_sol", coin: "usdc", solNeededLamports: 4_000_000n });
  });

  it("never lists SOL as a swap input when only the fee reserve is left", () => {
    const d = decide(GBP(), wallet("100", "20", 5_000_000n), { reserve: 5_000_000n });
    expect(d.kind === "swap_required" && d.swapInputs.map((i) => i.asset)).toEqual(["usdt"]);
  });

  it("calls our own limits an amount problem, not an unsupported destination", () => {
    const outOfLimits: Candidate[] = PAYMENT_CURRENCIES.map((coin) => ({
      coin,
      verdict: "out_of_limits" as const,
      code: null,
      reason: "Payments must be between 100 and 1,000,000.",
    }));
    expect(decide(outOfLimits, null)).toMatchObject({
      kind: "none_priced",
      error: "amount_rejected",
    });
  });
});
