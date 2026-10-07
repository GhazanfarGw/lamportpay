/** Operations case workflow (lib/payments/cases) and its database rules. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  allowedNextStatuses,
  CASE_KINDS,
  CASE_STATUSES,
  checkCaseTransition,
  isCaseOpen,
  validateCaseFields,
} from "@/lib/payments/cases";

const SIG = "5igSigAbCdEfGhJkLmNoPqRsTuVwXyZ123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTU";
const WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

describe("case workflow", () => {
  it("follows required → requested → waiting → confirmed → notified → closed", () => {
    const path = [
      "refund_required",
      "refund_requested",
      "waiting_for_stables",
      "refund_confirmed",
      "customer_notified",
      "closed",
    ] as const;
    for (let i = 1; i < path.length; i++) {
      expect(checkCaseTransition(path[i - 1]!, path[i]!)).toEqual({ ok: true });
    }
  });

  it("lets a failed refund be requested again", () => {
    expect(checkCaseTransition("waiting_for_stables", "refund_failed")).toEqual({ ok: true });
    expect(checkCaseTransition("refund_failed", "refund_requested")).toEqual({ ok: true });
  });

  it("never reopens or moves a closed case, and never skips to confirmed", () => {
    expect(allowedNextStatuses("closed")).toEqual([]);
    expect(checkCaseTransition("closed", "refund_required").ok).toBe(false);
    expect(checkCaseTransition("refund_required", "refund_confirmed").ok).toBe(false);
    expect(checkCaseTransition("customer_notified", "refund_requested").ok).toBe(false);
    expect(checkCaseTransition("refund_confirmed", "refund_confirmed").ok).toBe(false);
  });

  it("lets any open case be closed", () => {
    for (const s of CASE_STATUSES.filter(isCaseOpen)) {
      expect(checkCaseTransition(s, "closed")).toEqual({ ok: true });
    }
  });

  it("validates recorded facts", () => {
    expect(validateCaseFields({})).toBeNull();
    expect(
      validateCaseFields({
        original_wallet: WALLET,
        refund_tx_signature: SIG,
        refund_amount_minor: 100_000_000,
        asset: "usdc",
        refund_destination: "Sending wallet, as agreed with Stables",
      }),
    ).toBeNull();
    expect(validateCaseFields({ refund_amount_minor: -1 })).toMatch(/minor units/);
    expect(validateCaseFields({ original_amount_minor: 1.5 })).toMatch(/minor units/);
    expect(validateCaseFields({ refund_tx_signature: "0xabc" })).toMatch(/Solana signature/);
    expect(validateCaseFields({ original_wallet: "not a wallet" })).toMatch(/Solana address/);
    expect(validateCaseFields({ asset: "sol" })).toMatch(/USDC or USDT/);
  });
});

describe("payment_cases migration", () => {
  const sql = readFileSync("supabase/migrations/20261007100000_payment_cases.sql", "utf8");

  it("keeps the kinds and statuses in sync with the code", () => {
    for (const k of CASE_KINDS) expect(sql).toContain(`'${k}'`);
    for (const s of CASE_STATUSES) expect(sql).toContain(`'${s}'`);
  });

  it("allows one open case per payment, admins only, with append-only history", () => {
    expect(sql).toMatch(/unique index[^;]+payment_cases \(payment_id\) where status <> 'closed'/);
    expect(sql).toMatch(
      /revoke all on public\.payment_cases, public\.payment_case_events from anon/,
    );
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*payment_cases/i);
    expect(sql).toMatch(/before update or delete on public\.payment_case_events/);
    expect(
      sql.match(/has_role\(auth\.uid\(\), 'admin'::app_role\)/g)?.length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("never touches the payment status", () => {
    expect(sql).not.toMatch(/update public\.payments/i);
    expect(sql).not.toMatch(/alter table public\.payments/i);
  });
});
