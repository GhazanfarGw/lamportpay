/**
 * Revenue reconciliation (Phase 3, C10). Pure: the caller loads the records.
 *
 * Three independent sources for LamportPay's own fee, per coin:
 *   1. expected  — the fee fixed on each payment (payments.platform_fee_minor)
 *                  and its "expected" row in the append-only fee ledger;
 *   2. received  — what the verified on-chain funding transaction paid to the
 *                  revenue wallet (payments.platform_fee_received_minor) and its
 *                  "received" ledger row;
 *   3. on-chain  — the revenue wallet's current token balance on Solana.
 *
 * 1 vs 2 is exact, per payment. The ledger must also agree with the payment
 * columns. 3 is informative only: the owner may move funds out of the revenue
 * wallet or receive other deposits, so a difference is shown and explained,
 * never treated as a failure.
 */
export type ReconPaymentRow = {
  id: string;
  currency: string;
  feeMinor: bigint;
  receivedMinor: bigint | null;
  fundingVerified: boolean;
};

export type ReconLedgerRow = {
  paymentId: string;
  entryType: "expected" | "received";
  amountMinor: bigint;
  currency: string;
};

export type ReconIssue = {
  paymentId: string;
  kind: "fee_short" | "fee_missing" | "ledger_expected_mismatch" | "ledger_received_mismatch";
  expectedMinor: string;
  actualMinor: string;
};

export type CoinReconciliation = {
  currency: string;
  fundedPayments: number;
  pendingPayments: number;
  expectedMinor: string;
  receivedMinor: string;
  shortfallMinor: string;
  ledgerExpectedMinor: string;
  ledgerReceivedMinor: string;
  onChainBalanceMinor: string | null;
  /** On-chain balance minus fees received; null when the balance is unknown. */
  onChainDifferenceMinor: string | null;
};

export type RevenueReconciliation = {
  coins: CoinReconciliation[];
  issues: ReconIssue[];
  /** True when every funded payment's fee arrived and the ledger agrees. */
  balanced: boolean;
  onChain:
    | { status: "ok"; readAt: string }
    | { status: "not_configured" }
    | { status: "unavailable"; reason: string };
};

export function reconcileRevenue(
  payments: ReconPaymentRow[],
  ledger: ReconLedgerRow[],
  onChain:
    | { status: "ok"; readAt: string; balances: Record<string, bigint> }
    | { status: "not_configured" }
    | { status: "unavailable"; reason: string },
): RevenueReconciliation {
  const ledgerBy = new Map<string, { expected: bigint; received: bigint; hasReceived: boolean }>();
  for (const row of ledger) {
    const e = ledgerBy.get(row.paymentId) ?? { expected: 0n, received: 0n, hasReceived: false };
    if (row.entryType === "expected") e.expected += row.amountMinor;
    else {
      e.received += row.amountMinor;
      e.hasReceived = true;
    }
    ledgerBy.set(row.paymentId, e);
  }

  const issues: ReconIssue[] = [];
  const coins = new Map<
    string,
    {
      funded: number;
      pending: number;
      expected: bigint;
      received: bigint;
      ledgerExpected: bigint;
      ledgerReceived: bigint;
    }
  >();
  const coin = (c: string) => {
    const key = c.toLowerCase();
    let v = coins.get(key);
    if (!v) {
      v = {
        funded: 0,
        pending: 0,
        expected: 0n,
        received: 0n,
        ledgerExpected: 0n,
        ledgerReceived: 0n,
      };
      coins.set(key, v);
    }
    return v;
  };

  for (const p of payments) {
    if (p.feeMinor <= 0n) continue;
    const c = coin(p.currency);
    const l = ledgerBy.get(p.id);
    if (!p.fundingVerified) {
      c.pending += 1;
      continue;
    }
    const got = p.receivedMinor ?? 0n;
    c.funded += 1;
    c.expected += p.feeMinor;
    c.received += got;
    c.ledgerExpected += l?.expected ?? 0n;
    c.ledgerReceived += l?.received ?? 0n;
    if (got < p.feeMinor) {
      issues.push({
        paymentId: p.id,
        kind: got > 0n ? "fee_short" : "fee_missing",
        expectedMinor: p.feeMinor.toString(),
        actualMinor: got.toString(),
      });
    }
    if ((l?.expected ?? 0n) !== p.feeMinor) {
      issues.push({
        paymentId: p.id,
        kind: "ledger_expected_mismatch",
        expectedMinor: p.feeMinor.toString(),
        actualMinor: (l?.expected ?? 0n).toString(),
      });
    }
    if ((l?.received ?? 0n) !== got) {
      issues.push({
        paymentId: p.id,
        kind: "ledger_received_mismatch",
        expectedMinor: got.toString(),
        actualMinor: (l?.received ?? 0n).toString(),
      });
    }
  }

  const balances = onChain.status === "ok" ? onChain.balances : null;
  for (const c of Object.keys(balances ?? {})) coin(c);

  return {
    coins: [...coins].map(([currency, c]) => {
      const balance = balances ? (balances[currency] ?? 0n) : null;
      return {
        currency,
        fundedPayments: c.funded,
        pendingPayments: c.pending,
        expectedMinor: c.expected.toString(),
        receivedMinor: c.received.toString(),
        shortfallMinor: (c.expected > c.received ? c.expected - c.received : 0n).toString(),
        ledgerExpectedMinor: c.ledgerExpected.toString(),
        ledgerReceivedMinor: c.ledgerReceived.toString(),
        onChainBalanceMinor: balance === null ? null : balance.toString(),
        onChainDifferenceMinor: balance === null ? null : (balance - c.received).toString(),
      };
    }),
    issues,
    balanced: issues.length === 0,
    onChain:
      onChain.status === "ok"
        ? { status: "ok", readAt: onChain.readAt }
        : onChain.status === "unavailable"
          ? { status: "unavailable", reason: onChain.reason }
          : { status: "not_configured" },
  };
}
