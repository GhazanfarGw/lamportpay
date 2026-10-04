/** C10: revenue reconciliation — expected vs received vs ledger vs on-chain. */
import { describe, expect, it } from "vitest";

import { reconcileRevenue, type ReconLedgerRow } from "@/lib/payments/revenue-reconciliation";

const U = 1_000_000n;
const ok = (p: string, amount: bigint): ReconLedgerRow[] => [
  { paymentId: p, entryType: "expected", amountMinor: amount, currency: "usdc" },
  { paymentId: p, entryType: "received", amountMinor: amount, currency: "usdc" },
];

describe("reconcileRevenue", () => {
  it("is balanced when every funded fee arrived and the ledger agrees", () => {
    const r = reconcileRevenue(
      [
        {
          id: "a",
          currency: "usdc",
          feeMinor: 2n * U,
          receivedMinor: 2n * U,
          fundingVerified: true,
        },
        {
          id: "b",
          currency: "usdc",
          feeMinor: 3n * U,
          receivedMinor: 3n * U,
          fundingVerified: true,
        },
        // Not funded yet: counted as awaiting, not as missing.
        {
          id: "c",
          currency: "usdc",
          feeMinor: 1n * U,
          receivedMinor: null,
          fundingVerified: false,
        },
      ],
      [...ok("a", 2n * U), ...ok("b", 3n * U)],
      { status: "ok", readAt: "2026-10-01T00:00:00Z", balances: { usdc: 5n * U, usdt: 0n } },
    );
    expect(r.balanced).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.coins.find((c) => c.currency === "usdc")).toMatchObject({
      fundedPayments: 2,
      pendingPayments: 1,
      expectedMinor: "5000000",
      receivedMinor: "5000000",
      shortfallMinor: "0",
      ledgerExpectedMinor: "5000000",
      ledgerReceivedMinor: "5000000",
      onChainBalanceMinor: "5000000",
      onChainDifferenceMinor: "0",
    });
  });

  it("flags a short fee, a missing fee and a ledger that disagrees", () => {
    const r = reconcileRevenue(
      [
        {
          id: "short",
          currency: "usdc",
          feeMinor: 2n * U,
          receivedMinor: 1n * U,
          fundingVerified: true,
        },
        {
          id: "none",
          currency: "usdc",
          feeMinor: 2n * U,
          receivedMinor: 0n,
          fundingVerified: true,
        },
        {
          id: "led",
          currency: "usdc",
          feeMinor: 2n * U,
          receivedMinor: 2n * U,
          fundingVerified: true,
        },
      ],
      [
        { paymentId: "short", entryType: "expected", amountMinor: 2n * U, currency: "usdc" },
        { paymentId: "short", entryType: "received", amountMinor: 1n * U, currency: "usdc" },
        { paymentId: "none", entryType: "expected", amountMinor: 2n * U, currency: "usdc" },
        // "led": the expected row is missing from the ledger.
        { paymentId: "led", entryType: "received", amountMinor: 2n * U, currency: "usdc" },
      ],
      { status: "not_configured" },
    );
    expect(r.balanced).toBe(false);
    expect(r.issues.map((i) => `${i.paymentId}:${i.kind}`)).toEqual([
      "short:fee_short",
      "none:fee_missing",
      "led:ledger_expected_mismatch",
    ]);
    expect(r.coins[0]).toMatchObject({ shortfallMinor: "3000000", onChainBalanceMinor: null });
    expect(r.onChain).toEqual({ status: "not_configured" });
  });

  it("shows the on-chain difference without treating it as an error", () => {
    const r = reconcileRevenue(
      [
        {
          id: "a",
          currency: "usdc",
          feeMinor: 2n * U,
          receivedMinor: 2n * U,
          fundingVerified: true,
        },
      ],
      ok("a", 2n * U),
      // The owner moved 1.5 USDC out of the revenue wallet.
      { status: "ok", readAt: "2026-10-01T00:00:00Z", balances: { usdc: 500_000n } },
    );
    expect(r.balanced).toBe(true);
    expect(r.coins[0]!.onChainDifferenceMinor).toBe("-1500000");
  });

  it("reports an unreadable wallet as unavailable, never as a zero balance", () => {
    const r = reconcileRevenue([], [], { status: "unavailable", reason: "rpc down" });
    expect(r.onChain).toEqual({ status: "unavailable", reason: "rpc down" });
    expect(r.coins).toEqual([]);
  });
});
