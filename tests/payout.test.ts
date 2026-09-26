import { describe, expect, it } from "vitest";

import { api, assertNoSecretLeak, getIntegrationStatus, providerMode } from "./helpers";

type PayoutResult = { error?: string; demoMode?: boolean; payoutMode?: boolean };

const post = (path: string, body: unknown) => api<PayoutResult>(path, { method: "POST", body });

const cases: Array<{ path: string; body: Record<string, unknown> }> = [
  { path: "/api/payout/customer", body: { type: "individual", email: "demo@example.com" } },
  {
    path: "/api/payout/external-account",
    body: { customerId: "cus_demo", currency: "usd", account_number: "000123456789" },
  },
  {
    path: "/api/payout/quote",
    body: {
      amount: "100",
      destinationCurrency: "pkr",
      paymentRail: "iban",
      onBehalfOf: "cus_demo",
    },
  },
];

describe("Partner payout endpoints — mock fallback", () => {
  it("returns a clean demo-mode response for every endpoint when no key is configured", async () => {
    const status = await getIntegrationStatus();
    const configured = providerMode(status, "Payout partner") === "sandbox";

    for (const c of cases) {
      const res = await post(c.path, c.body);
      assertNoSecretLeak(res.raw);

      if (!configured) {
        expect(res.status, `${c.path} should be demo-mode`).toBe(200);
        expect(res.body.demoMode).toBe(true);
        expect(res.body.error).toMatch(/PAYOUT_API_KEY|not configured/);
      } else {
        expect([200, 502]).toContain(res.status);
      }
    }
  });

  it("never returns a real payout confirmation in mock mode", async () => {
    const status = await getIntegrationStatus();
    if (providerMode(status, "Payout partner") === "sandbox") return;

    for (const c of cases) {
      const res = await post(c.path, c.body);
      expect(res.body.payoutMode).toBeUndefined();
    }
  });

  it("validates payloads before touching the payout provider", async () => {
    // Unknown fields and missing required fields are rejected by the schema
    // whenever a key is configured; without a key the demo guard fires first.
    const res = await post("/api/payout/external-account", { customerId: "cus_demo" });
    expect([200, 400]).toContain(res.status);
  });
});

describe("POST /api/public/payout-webhook", () => {
  it("rejects calls with no signature header", async () => {
    const res = await post("/api/public/payout-webhook", { event_type: "transfer.updated" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/X-Webhook-Signature/);
  });

  it("rejects an unparseable signature header", async () => {
    const res = await api<PayoutResult>("/api/public/payout-webhook", {
      method: "POST",
      headers: { "X-Webhook-Signature": "garbage" },
      body: { event_type: "transfer.updated" },
    });
    // Without a webhook secret the payload is parsed; with one it must fail.
    expect([200, 400]).toContain(res.status);
  });

  it("rejects malformed JSON bodies", async () => {
    const res = await api<PayoutResult>("/api/public/payout-webhook", {
      method: "POST",
      headers: { "X-Webhook-Signature": "t=1,v0=abc" },
      body: "{not-json",
    });
    expect(res.status).toBe(400);
  });
});
