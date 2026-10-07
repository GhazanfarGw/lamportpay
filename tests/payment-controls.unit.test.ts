/** Emergency controls (lib/payments/controls): validation, fail-closed reads, refusals, limits. */
import { describe, expect, it, vi } from "vitest";

import { toMajor } from "@/lib/money";
import {
  controlsForMode,
  narrowLimits,
  parseModeControls,
  pauseRefusal,
} from "@/lib/payments/controls";

const usdc = (minor: number) => toMajor(BigInt(minor), "usdc");

describe("emergency controls", () => {
  it("defaults to open", () => {
    const c = parseModeControls(null);
    expect(c).toEqual({ paused: false, reason: null, corridors: {} });
    expect(pauseRefusal(c, "INR")).toBeNull();
  });

  it("requires a reason to pause, globally and per currency", () => {
    expect(() => parseModeControls({ paused: true })).toThrow(/reason/);
    expect(() =>
      parseModeControls({ paused: false, corridors: { INR: { paused: true } } }),
    ).toThrow(/INR needs a reason/);
  });

  it("refuses invalid currencies and amounts", () => {
    expect(() => parseModeControls({ corridors: { india: { paused: false } } })).toThrow(
      /not a currency code/,
    );
    expect(() => parseModeControls({ corridors: { INR: { min_minor: -5 } } })).toThrow(
      /positive amount/,
    );
    expect(() =>
      parseModeControls({ corridors: { INR: { min_minor: 900, max_minor: 100 } } }),
    ).toThrow(/minimum is above the maximum/);
  });

  it("normalizes currency keys and drops rules that restrict nothing", () => {
    const c = parseModeControls({
      corridors: { inr: { paused: true, reason: "bank holiday" }, gbp: { paused: false } },
    });
    expect(Object.keys(c.corridors)).toEqual(["INR"]);
  });

  it("refuses everything while paused, and only the paused currency otherwise", () => {
    const global = parseModeControls({ paused: true, reason: "incident" });
    expect(pauseRefusal(global, "GBP")).toMatchObject({ code: "payments_paused", status: 503 });
    expect(pauseRefusal(global, null)).toMatchObject({ code: "payments_paused" });

    const corridor = parseModeControls({ corridors: { INR: { paused: true, reason: "partner" } } });
    expect(pauseRefusal(corridor, "inr")).toMatchObject({ code: "corridor_paused" });
    expect(pauseRefusal(corridor, "GBP")).toBeNull();
    // A step that does not depend on the corridor (funding) passes no currency.
    expect(pauseRefusal(corridor, null)).toBeNull();
  });

  it("keeps TEST and LIVE rules separate, and fails closed on a corrupt row", () => {
    const stored = { test: { paused: true, reason: "sandbox outage" }, live: { paused: false } };
    expect(controlsForMode(stored, "test").paused).toBe(true);
    expect(controlsForMode(stored, "live").paused).toBe(false);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(controlsForMode({ live: { paused: true } }, "live")).toMatchObject({ paused: true });
    expect(controlsForMode({ live: "garbage" }, "live")).toMatchObject({ paused: true });
    spy.mockRestore();
  });

  it("only ever narrows coin limits", () => {
    const coin = { min: "15", max: "1000000" };
    const rule = { paused: false, reason: null, min_minor: 50_000_000, max_minor: 5_000_000_000 };
    expect(narrowLimits(coin, rule, usdc)).toEqual({ min: "50", max: "5000" });
    // A looser corridor rule does not widen the coin limits.
    const loose = { paused: false, reason: null, min_minor: 1_000_000, max_minor: null };
    expect(narrowLimits(coin, loose, usdc)).toEqual(coin);
    expect(narrowLimits(coin, undefined, usdc)).toBe(coin);
    // Contradiction with the coin limits: misconfigured (payments answer 503).
    const above = { paused: false, reason: null, min_minor: 2_000_000_000_000, max_minor: null };
    expect(narrowLimits(coin, above, usdc)).toBeNull();
  });
});
