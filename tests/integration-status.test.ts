import { describe, expect, it } from "vitest";

import { api, assertNoSecretLeak, getIntegrationStatus, type IntegrationStatus } from "./helpers";

describe("GET /api/integration-status", () => {
  it("reports both providers with a mode and never leaks key material", async () => {
    const res = await api<IntegrationStatus>("/api/integration-status");
    expect(res.status).toBe(200);
    assertNoSecretLeak(res.raw);

    const names = res.body.providers.map((p) => p.name);
    expect(names).toContain("Jupiter");
    expect(names).toContain("Payout partner");

    for (const provider of res.body.providers) {
      expect(["sandbox", "mock"]).toContain(provider.mode);
      expect(typeof provider.configured).toBe("boolean");
      // Booleans only — no key values, prefixes or lengths.
      expect(JSON.stringify(provider)).not.toMatch(/api_[A-Za-z0-9]/);
    }
  });

  it("keeps configured flags and modes consistent", async () => {
    const status = await getIntegrationStatus();
    for (const provider of status.providers) {
      expect(provider.mode).toBe(provider.configured ? "sandbox" : "mock");
    }
  });

  it("lists the Jupiter and payout endpoints", async () => {
    const status = await getIntegrationStatus();
    const paths = status.endpoints.map((e) => e.path);
    expect(paths.some((p) => p.includes("/api/jupiter/quote"))).toBe(true);
    expect(paths.some((p) => p.includes("/api/payout/"))).toBe(true);
  });
});
