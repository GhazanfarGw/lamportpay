import { describe, expect, it } from "vitest";

import { api, assertNoSecretLeak } from "./helpers";

type ErrorBody = { error?: string; received?: boolean };

const PAYMENT_ID = "00000000-0000-4000-8000-000000000000";

const userEndpoints: Array<{ method: string; path: string; body?: unknown }> = [
  { method: "GET", path: "/api/kyc" },
  { method: "POST", path: "/api/kyc", body: {} },
  { method: "POST", path: "/api/payments", body: { amount: "10", country: "IN", currency: "inr" } },
  { method: "GET", path: `/api/payments/${PAYMENT_ID}` },
  { method: "POST", path: `/api/payments/${PAYMENT_ID}/quote` },
  { method: "POST", path: `/api/payments/${PAYMENT_ID}/transfer`, body: {} },
  {
    method: "POST",
    path: `/api/payments/${PAYMENT_ID}/funding-transaction`,
    body: { payer: "11111111111111111111111111111111" },
  },
  {
    method: "POST",
    path: `/api/payments/${PAYMENT_ID}/funding`,
    body: { signature: "1".repeat(88) },
  },
];

describe("Payment API — authentication", () => {
  it("rejects every payment endpoint without a session", async () => {
    for (const e of userEndpoints) {
      const res = await api<ErrorBody>(e.path, { method: e.method, body: e.body });
      assertNoSecretLeak(res.raw);
      expect(res.status, `${e.method} ${e.path}`).toBe(401);
    }
  });

  it("rejects a forged bearer token", async () => {
    const forged = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";
    for (const e of userEndpoints) {
      const res = await api<ErrorBody>(e.path, {
        method: e.method,
        body: e.body,
        headers: { Authorization: `Bearer ${forged}` },
      });
      expect(res.status, `${e.method} ${e.path}`).toBe(401);
    }
  });
});

describe("POST /api/public/stables-webhook", () => {
  const event = {
    event_id: "evt_test",
    event_type: "transfer.updated.status_transitioned",
    event_object_id: "tr_test",
    event_object: { transfer_id: "tr_test", status: "COMPLETED" },
  };

  it("rejects unsigned and X-Webhook-Signature deliveries with 401", async () => {
    for (const headers of [{}, { "X-Webhook-Signature": "deadbeef" }]) {
      const res = await api<ErrorBody>("/api/public/stables-webhook", {
        method: "POST",
        headers,
        body: event,
      });
      expect(res.status).toBe(401);
      expect(res.body.received).toBeUndefined();
    }
  });

  it("rejects forged Svix signatures", async () => {
    const now = String(Math.floor(Date.now() / 1000));
    const res = await api<ErrorBody>("/api/public/stables-webhook", {
      method: "POST",
      headers: { "svix-id": "msg_1", "svix-timestamp": now, "svix-signature": "v1,Zm9yZ2Vk" },
      body: event,
    });
    // 503 without a webhook secret configured, 401 with one.
    expect([401, 503]).toContain(res.status);
    expect(res.body.received).toBeUndefined();
  });
});

describe("GET|POST /api/cron/reconcile-payments", () => {
  it("refuses callers without the cron secret", async () => {
    const variants: Array<Record<string, string>> = [
      {},
      { Authorization: "Bearer not-the-cron-secret" },
    ];
    for (const method of ["GET", "POST"]) {
      for (const headers of variants) {
        const res = await api<ErrorBody>("/api/cron/reconcile-payments", { method, headers });
        assertNoSecretLeak(res.raw);
        // 500 when CRON_SECRET is not configured on the server, 401 otherwise.
        expect([401, 500], `${method} ${JSON.stringify(headers)}`).toContain(res.status);
      }
    }
  });
});
