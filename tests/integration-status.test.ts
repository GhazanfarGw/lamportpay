import { describe, expect, it } from "vitest";

import { api, assertNoSecretLeak, getIntegrationStatus, type IntegrationStatus } from "./helpers";

describe("GET /api/integration-status", () => {
  it("reports both providers with a mode and never leaks key material", async () => {
    const res = await api<IntegrationStatus>("/api/integration-status");
    expect(res.status).toBe(200);
    assertNoSecretLeak(res.raw);

    const names = res.body.providers.map((p) => p.name);
    expect(names).toContain("Jupiter");
    expect(names).toContain("Stables");

    for (const provider of res.body.providers) {
      expect(["sandbox", "live", "mock"]).toContain(provider.mode);
      expect(typeof provider.configured).toBe("boolean");
      // Booleans only — no key values, prefixes or lengths.
      expect(JSON.stringify(provider)).not.toMatch(/sti_(test|live)_/);
    }
  });

  it("keeps configured flags and modes consistent", async () => {
    const status = await getIntegrationStatus();
    for (const provider of status.providers) {
      if (provider.configured) expect(provider.mode).not.toBe("mock");
      else expect(provider.mode).toBe("mock");
    }
  });

  it("lists the Jupiter and Stables payment endpoints", async () => {
    const status = await getIntegrationStatus();
    const paths = status.endpoints.map((e) => e.path);
    expect(paths.some((p) => p.includes("/api/jupiter/quote"))).toBe(true);
    expect(paths.some((p) => p.includes("/api/payments"))).toBe(true);
    expect(paths.some((p) => p.includes("/api/public/stables-webhook"))).toBe(true);
  });
});
