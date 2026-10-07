/** Platform-wide rate limiting (shared counter in Postgres, in-memory fallback). */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc } }));

import { allowShared, resetRateLimits, USER_LIMITS } from "@/lib/payments/rate-limit.server";

beforeEach(() => {
  rpc.mockReset();
  resetRateLimits();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("shared rate limiter", () => {
  it("asks the database and follows its answer", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await allowShared("payment-create", "u:1", 10)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_bucket: "payment-create",
      p_key: "u:1",
      p_limit: 10,
      p_window_seconds: 60,
    });
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await allowShared("payment-create", "u:1", 10)).toBe(false);
  });

  it("falls back to a per-instance limit when the database fails, never fully open", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await allowShared("kyc", "u:2", 3));
    expect(results).toEqual([true, true, true, false]);
  });

  it("never logs the user id or IP of a refused caller", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await allowShared("payment-quote", "ip:203.0.113.9", 20);
    const logged = warn.mock.calls.map((c) => String(c[0])).join(" ");
    expect(logged).toContain("rate_limited");
    expect(logged).not.toContain("203.0.113.9");
  });

  it("is stricter on money-moving actions than on reads", () => {
    expect(USER_LIMITS.createPayment.perMinute).toBeLessThan(USER_LIMITS.default.perMinute);
    expect(USER_LIMITS.transfer.perMinute).toBeLessThan(USER_LIMITS.default.perMinute);
    expect(USER_LIMITS.kyc.perMinute).toBeLessThan(USER_LIMITS.default.perMinute);
  });
});
