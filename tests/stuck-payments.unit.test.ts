import { describe, expect, it } from "vitest";

import { STUCK_AFTER_MS, stuckSignal } from "@/lib/payments/stuck";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("stuck payment monitoring", () => {
  it("flags a payment Stables has not moved for longer than the threshold", () => {
    const s = stuckSignal(
      {
        status: "IN_PROGRESS",
        created_at: ago(30 * 3_600_000),
        status_changed_at: ago(21 * 3_600_000),
      },
      NOW,
    );
    expect(s).toMatchObject({ waitingOn: "stables" });
    expect(s?.label).toContain("21h");
    expect(s?.label).toContain("IN_PROGRESS");
  });

  it("does not flag a payment still within the normal window", () => {
    expect(
      stuckSignal({ status: "IN_PROGRESS", created_at: ago(STUCK_AFTER_MS.stables - 60_000) }, NOW),
    ).toBeNull();
  });

  it("flags an unfunded transfer after a day, as waiting on the user", () => {
    expect(
      stuckSignal({ status: "CREATED", created_at: ago(STUCK_AFTER_MS.user + 1) }, NOW),
    ).toMatchObject({ waitingOn: "user" });
  });

  it("never flags finished or pre-transfer payments", () => {
    for (const status of [
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "EXPIRED",
      "QUOTED",
      "PAYMENT_CREATED",
    ]) {
      expect(stuckSignal({ status, created_at: ago(100 * 3_600_000) }, NOW)).toBeNull();
    }
  });
});
