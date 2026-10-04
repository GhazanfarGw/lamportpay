/** Throttle for the public /pay calculator endpoints. */
import { beforeEach, describe, expect, it } from "vitest";

import { allow, clientKey, resetRateLimits } from "@/lib/payments/rate-limit.server";

beforeEach(() => resetRateLimits());

describe("public endpoint rate limit", () => {
  it("allows up to the limit per key and window, then refuses", () => {
    for (let i = 0; i < 3; i++) expect(allow("estimate", "ip:1.2.3.4", 3)).toBe(true);
    expect(allow("estimate", "ip:1.2.3.4", 3)).toBe(false);
    // Other callers and other endpoints are counted separately.
    expect(allow("estimate", "ip:5.6.7.8", 3)).toBe(true);
    expect(allow("holdings", "ip:1.2.3.4", 3)).toBe(true);
  });

  it("opens again after the window", () => {
    expect(allow("estimate", "k", 1, 0)).toBe(true);
    expect(allow("estimate", "k", 1, 0)).toBe(true);
  });

  it("keys by signed-in user, else by the first forwarded IP", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } });
    expect(clientKey(req, "user-1")).toBe("u:user-1");
    expect(clientKey(req, null)).toBe("ip:9.9.9.9");
    expect(clientKey(new Request("http://x"), null)).toBe("ip:unknown");
  });
});
