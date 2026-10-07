/** Operations alerts (lib/payments/attention): what needs a person, never a status change. */
import { describe, expect, it } from "vitest";

import { attentionSignals, reachedFunds, topSeverity } from "@/lib/payments/attention";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const codes = (row: Parameters<typeof attentionSignals>[0]) =>
  attentionSignals(row, NOW).map((s) => s.code);

describe("operations alerts", () => {
  it("raises nothing for a payment moving normally or completed", () => {
    expect(
      codes({ status: "IN_PROGRESS", created_at: hoursAgo(1), status_changed_at: hoursAgo(0.5) }),
    ).toEqual([]);
    expect(
      codes({ status: "COMPLETED", created_at: hoursAgo(48), funding_signature: "sig" }),
    ).toEqual([]);
  });

  it("flags a wrong deposit that moved funds, as critical", () => {
    const s = attentionSignals(
      { status: "AWAITING_FUNDS_COLLECTION", created_at: hoursAgo(1), depositMismatch: true },
      NOW,
    );
    expect(s[0]).toMatchObject({ code: "deposit_mismatch", severity: "critical" });
    expect(s[0]!.action).toMatch(/do not ask the user to send again/);
  });

  it("ignores an old mismatch once a correct deposit was verified", () => {
    expect(
      codes({
        status: "IN_PROGRESS",
        created_at: hoursAgo(1),
        status_changed_at: hoursAgo(0.5),
        depositMismatch: true,
        funding_signature: "sig",
      }),
    ).not.toContain("deposit_mismatch");
  });

  it("asks for a refund case when a payment ended after funds reached Stables", () => {
    for (const status of ["FAILED", "CANCELLED", "EXPIRED"]) {
      expect(codes({ status, created_at: hoursAgo(5), everCollectedFunds: true })).toContain(
        "ended_after_funds",
      );
      expect(
        codes({ status, created_at: hoursAgo(5), funding_verified_at: hoursAgo(4) }),
      ).toContain("ended_after_funds");
    }
  });

  it("does not ask for a refund when no funds ever moved", () => {
    expect(codes({ status: "EXPIRED", created_at: hoursAgo(30) })).toEqual([]);
    expect(codes({ status: "CANCELLED", created_at: hoursAgo(30) })).toEqual([]);
  });

  it("escalates a payment waiting on Stables: warning after 2 h, critical after 24 h", () => {
    const at = (h: number) =>
      attentionSignals(
        { status: "IN_PROGRESS", created_at: hoursAgo(h + 1), status_changed_at: hoursAgo(h) },
        NOW,
      );
    expect(at(1)).toEqual([]);
    expect(at(3)[0]).toMatchObject({ code: "stables_slow", severity: "warning" });
    expect(at(25)[0]).toMatchObject({ code: "stables_very_slow", severity: "critical" });
  });

  it("marks a compliance hold, and an unfunded transfer as info only", () => {
    expect(
      attentionSignals(
        { status: "COMPLIANCE_HOLD", created_at: hoursAgo(1), status_changed_at: hoursAgo(0.5) },
        NOW,
      )[0],
    ).toMatchObject({
      code: "compliance_hold",
      severity: "warning",
    });
    const unfunded = attentionSignals(
      { status: "AWAITING_FUNDS_COLLECTION", created_at: hoursAgo(30) },
      NOW,
    );
    expect(unfunded).toEqual([
      expect.objectContaining({ code: "deposit_not_received", severity: "info" }),
    ]);
  });

  it("notes abandoned quotes, webhook failures and open cases", () => {
    expect(
      codes({ status: "QUOTED", created_at: hoursAgo(3), quote_expires_at: hoursAgo(2) }),
    ).toEqual(["quote_abandoned"]);
    expect(
      codes({ status: "QUOTED", created_at: hoursAgo(1), quote_expires_at: hoursAgo(0.2) }),
    ).toEqual([]);
    expect(codes({ status: "CREATED", created_at: hoursAgo(0.1), webhookError: true })).toEqual([
      "webhook_error",
    ]);
    expect(codes({ status: "COMPLETED", created_at: hoursAgo(1), openCase: true })).toEqual([
      "case_open",
    ]);
  });

  it("sorts the most severe alert first", () => {
    const s = attentionSignals(
      {
        status: "FAILED",
        created_at: hoursAgo(5),
        everCollectedFunds: true,
        webhookError: true,
        openCase: true,
      },
      NOW,
    );
    expect(topSeverity(s)).toBe("critical");
    expect(s.map((x) => x.severity)).toEqual(["critical", "warning", "warning"]);
  });

  it("detects funds from the status history", () => {
    expect(reachedFunds(["CREATED", "AWAITING_FUNDS_COLLECTION"])).toBe(false);
    expect(reachedFunds(["CREATED", "FUNDS_COLLECTED", "FAILED"])).toBe(true);
    expect(reachedFunds([null, "IN_PROGRESS"])).toBe(true);
  });
});
