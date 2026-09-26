import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ACTIVE_TRANSFER_STATES,
  PAYMENT_STATES,
  TRANSFER_STATES,
  checkTransition,
  liftsTravelRuleHold,
  normalizeTransferStatus,
  type PaymentState,
  type TransferState,
} from "@/lib/payments/state";

const ok = (from: PaymentState, to: PaymentState, preHold: TransferState | null = null) =>
  checkTransition(from, to, preHold).ok;

describe("pre-transfer states", () => {
  it("walks the happy path", () => {
    expect(ok("PAYMENT_CREATED", "KYC_PENDING")).toBe(true);
    expect(ok("KYC_PENDING", "KYC_APPROVED")).toBe(true);
    expect(ok("KYC_APPROVED", "QUOTED")).toBe(true);
    expect(ok("QUOTED", "CREATED")).toBe(true);
  });

  it("lets an already-verified customer skip KYC_PENDING", () => {
    expect(ok("PAYMENT_CREATED", "KYC_APPROVED")).toBe(true);
  });

  it("never quotes or starts a transfer without an approved customer", () => {
    expect(ok("PAYMENT_CREATED", "QUOTED")).toBe(false);
    expect(ok("KYC_PENDING", "QUOTED")).toBe(false);
    expect(ok("KYC_APPROVED", "CREATED")).toBe(false);
    expect(ok("KYC_PENDING", "AWAITING_FUNDS_COLLECTION")).toBe(false);
  });

  it("moves forward only", () => {
    expect(ok("KYC_APPROVED", "KYC_PENDING")).toBe(false);
    expect(ok("QUOTED", "KYC_APPROVED")).toBe(false);
    expect(ok("QUOTED", "QUOTED")).toBe(false);
  });

  it("treats KYC rejection as terminal", () => {
    expect(ok("KYC_PENDING", "KYC_REJECTED")).toBe(true);
    expect(ok("KYC_APPROVED", "KYC_REJECTED")).toBe(false);
    expect(ok("KYC_REJECTED", "KYC_APPROVED")).toBe(false);
  });

  it("can be cancelled at any point before the transfer", () => {
    for (const from of ["PAYMENT_CREATED", "KYC_PENDING", "KYC_APPROVED", "QUOTED"] as const) {
      expect(ok(from, "CANCELLED"), from).toBe(true);
    }
  });

  it("accepts the first transfer state even if a webhook got there first", () => {
    expect(ok("QUOTED", "AWAITING_FUNDS_COLLECTION")).toBe(true);
    expect(checkTransition("QUOTED", "COMPLIANCE_HOLD")).toEqual({ ok: true, preHold: "CREATED" });
  });
});

describe("Stables transfer states", () => {
  const happy: PaymentState[] = [
    "CREATED",
    "AWAITING_FUNDS_COLLECTION",
    "FUNDS_COLLECTED",
    "IN_PROGRESS",
    "PAYMENT_SUBMITTED",
    "PAYMENT_PROCESSED",
    "COMPLETED",
  ];

  it("walks the documented progression", () => {
    for (let i = 0; i < happy.length - 1; i++) {
      expect(ok(happy[i]!, happy[i + 1]!), `${happy[i]} → ${happy[i + 1]}`).toBe(true);
    }
  });

  it("allows skipping ahead but never moving backwards", () => {
    expect(ok("CREATED", "FUNDS_COLLECTED")).toBe(true);
    expect(ok("IN_PROGRESS", "COMPLETED")).toBe(true);
    for (let i = 1; i < happy.length - 1; i++) {
      for (let j = 0; j < i; j++) {
        expect(ok(happy[i]!, happy[j]!), `${happy[i]} → ${happy[j]}`).toBe(false);
      }
    }
    expect(ok("CREATED", "QUOTED")).toBe(false);
  });

  it("makes every terminal state final", () => {
    for (const terminal of ["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"] as const) {
      for (const to of PAYMENT_STATES) {
        expect(ok(terminal, to), `${terminal} → ${to}`).toBe(false);
      }
    }
  });

  it("allows FAILED from any non-terminal transfer state", () => {
    for (const from of happy.slice(0, -1)) expect(ok(from, "FAILED")).toBe(true);
    expect(ok("COMPLIANCE_HOLD", "FAILED", "IN_PROGRESS")).toBe(true);
  });

  it("allows CANCELLED and EXPIRED only before funds are collected", () => {
    expect(ok("CREATED", "CANCELLED")).toBe(true);
    expect(ok("AWAITING_FUNDS_COLLECTION", "EXPIRED")).toBe(true);
    expect(ok("FUNDS_COLLECTED", "CANCELLED")).toBe(false);
    expect(ok("IN_PROGRESS", "EXPIRED")).toBe(false);
  });

  it("resumes a compliance hold at the same state or later", () => {
    const entered = checkTransition("FUNDS_COLLECTED", "COMPLIANCE_HOLD");
    expect(entered).toEqual({ ok: true, preHold: "FUNDS_COLLECTED" });

    expect(ok("COMPLIANCE_HOLD", "FUNDS_COLLECTED", "FUNDS_COLLECTED")).toBe(true);
    expect(ok("COMPLIANCE_HOLD", "IN_PROGRESS", "FUNDS_COLLECTED")).toBe(true);
    expect(ok("COMPLIANCE_HOLD", "AWAITING_FUNDS_COLLECTION", "FUNDS_COLLECTED")).toBe(false);
    expect(ok("COMPLIANCE_HOLD", "EXPIRED", "FUNDS_COLLECTED")).toBe(false);
    expect(ok("COMPLIANCE_HOLD", "EXPIRED", "AWAITING_FUNDS_COLLECTION")).toBe(true);
    // A failed review may cancel the transfer whenever the hold began.
    expect(ok("COMPLIANCE_HOLD", "CANCELLED", "IN_PROGRESS")).toBe(true);
  });

  it("enters a compliance hold from every active state, remembering where", () => {
    for (const from of ACTIVE_TRANSFER_STATES.filter((s) => s !== "COMPLIANCE_HOLD")) {
      expect(checkTransition(from, "COMPLIANCE_HOLD"), from).toEqual({ ok: true, preHold: from });
    }
    expect(ok("COMPLIANCE_HOLD", "COMPLIANCE_HOLD", "CREATED")).toBe(false);
  });

  it("treats every non-terminal transfer state as active", () => {
    expect([...ACTIVE_TRANSFER_STATES].sort()).toEqual(
      TRANSFER_STATES.filter(
        (s) => !["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"].includes(s),
      ).sort(),
    );
  });

  it("clears the pre-hold marker when leaving the hold", () => {
    expect(checkTransition("COMPLIANCE_HOLD", "IN_PROGRESS", "FUNDS_COLLECTED")).toEqual({
      ok: true,
      preHold: null,
    });
  });
});

describe("normalizeTransferStatus", () => {
  it("accepts REST, webhook, and legacy spellings", () => {
    expect(normalizeTransferStatus("awaiting_funds_collection")).toBe("AWAITING_FUNDS_COLLECTION");
    expect(normalizeTransferStatus("COMPLETED")).toBe("COMPLETED");
    expect(normalizeTransferStatus("PAYMENT_STATUS_COMPLETED")).toBe("COMPLETED");
    expect(normalizeTransferStatus("PAYMENT_STATUS_FAILED")).toBe("FAILED");
  });

  it("returns null for statuses without state information", () => {
    expect(normalizeTransferStatus("unknown")).toBeNull();
    expect(normalizeTransferStatus("PAYMENT_STATUS_PENDING")).toBeNull();
    expect(normalizeTransferStatus(undefined)).toBeNull();
    expect(normalizeTransferStatus("QUOTED")).toBeNull();
  });
});

describe("liftsTravelRuleHold", () => {
  it("counts forward progress and completion, not holds, failures or pre-transfer states", () => {
    const lifting = PAYMENT_STATES.filter(liftsTravelRuleHold);
    expect([...lifting].sort()).toEqual(
      [
        "CREATED",
        "AWAITING_FUNDS_COLLECTION",
        "FUNDS_COLLECTED",
        "IN_PROGRESS",
        "PAYMENT_SUBMITTED",
        "PAYMENT_PROCESSED",
        "COMPLETED",
      ].sort(),
    );
  });
});

describe("schema", () => {
  const migration = (name: string) =>
    readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

  it("matches the payments.status check constraint", () => {
    const sql = migration("20260926120000_stables_payments.sql");
    const list =
      /status text not null default 'PAYMENT_CREATED' check \(status in \(([^)]*)\)\)/.exec(
        sql,
      )![1]!;
    const inSql = [...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect([...inSql].sort()).toEqual([...PAYMENT_STATES].sort());
  });

  it("allows every timeline source the ledger writes", () => {
    const sql = migration("20260926150000_payments_fix_round.sql");
    expect(sql).toMatch(/check \(source in \('api', 'webhook', 'reconcile'\)\)/);
  });

  it("adds the Travel Rule columns the ledger writes", () => {
    const sql = migration("20260926170000_travel_rule.sql");
    for (const column of [
      "travel_rule_reference",
      "travel_rule_verification_url",
      "travel_rule_expires_at",
      "travel_rule_requested_at",
      "travel_rule_resolved_at",
    ]) {
      expect(sql).toMatch(new RegExp(`add column ${column} `));
    }
    expect(sql).toContain("travel_rule_verification_url ~ '^https://'");
  });
});
