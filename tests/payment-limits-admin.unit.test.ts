/** C07: payment limits editable from admin, over the .env defaults. */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", async () => {
  const { createFakeSupabase } = await import("./support/fake-supabase");
  return { supabaseAdmin: createFakeSupabase() };
});

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  clearBusinessSettingsCache,
  getBusinessSettings,
  resolveBusinessSettings,
  updateBusinessSettings,
} from "@/lib/business-settings.server";

const ADMIN = "00000000-0000-4000-8000-000000000001";
const KEYS = ["PAYMENT_MIN_USDC", "PAYMENT_MAX_USDC", "PAYMENT_MIN_USDT", "PAYMENT_MAX_USDT"];

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
  // The stored (LIVE) limits; TEST MODE forces its own 1–5,000 USDC (tests/app-mode.unit.test.ts).
  vi.stubEnv("LAMPORTPAY_MODE", "live");
  clearBusinessSettingsCache();
  (supabaseAdmin as unknown as { reset: () => void }).reset();
});

describe("payment limits in business settings", () => {
  it("defaults to .env (100 minimum, 1,000,000 maximum)", () => {
    const s = resolveBusinessSettings(null);
    expect(s.paymentLimits.usdc).toEqual({ min: "100", max: "1000000" });
    expect(s.sources.paymentLimits.usdc).toBe("env");
  });

  it("keeps the owner's 'no LamportPay maximum' from .env", () => {
    process.env["PAYMENT_MAX_USDC"] = "none";
    expect(resolveBusinessSettings(null).paymentLimits.usdc).toEqual({ min: "100", max: null });
  });

  it("an admin can set, and then clear, limits per coin", async () => {
    await updateBusinessSettings(
      { paymentLimits: { usdc: { min_minor: 250_000_000, max_minor: null } } },
      ADMIN,
    );
    const s = await getBusinessSettings();
    expect(s.paymentLimits.usdc).toEqual({ min: "250", max: null });
    expect(s.sources.paymentLimits).toEqual({ usdc: "admin", usdt: "env" });
    expect(s.paymentLimits.usdt).toEqual({ min: "100", max: "1000000" });

    await updateBusinessSettings({ paymentLimits: { usdc: null } }, ADMIN);
    expect((await getBusinessSettings()).paymentLimits.usdc).toEqual({
      min: "100",
      max: "1000000",
    });
  });

  it("refuses to save a maximum below the minimum or a zero minimum", async () => {
    await expect(
      updateBusinessSettings(
        { paymentLimits: { usdc: { min_minor: 500_000_000, max_minor: 100_000_000 } } },
        ADMIN,
      ),
    ).rejects.toThrow(/minimum is above/);
    await expect(
      updateBusinessSettings({ paymentLimits: { usdc: { min_minor: 0, max_minor: null } } }, ADMIN),
    ).rejects.toThrow(/greater than zero/);
    expect((await getBusinessSettings()).sources.paymentLimits.usdc).toBe("env");
  });

  it("a misconfigured coin is marked, without pausing the other settings", () => {
    process.env["PAYMENT_MIN_USDC"] = "200";
    process.env["PAYMENT_MAX_USDC"] = "150";
    const s = resolveBusinessSettings(null);
    expect(s.paymentLimits.usdc).toBeNull();
    expect(s.paymentLimits.usdt).toEqual({ min: "100", max: "1000000" });
  });
});
