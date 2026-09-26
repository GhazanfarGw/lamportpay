import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { idempotencyKey } from "@/lib/stables/client.server";
import { getStablesConfig } from "@/lib/stables/config.server";
import { verifyStablesWebhook } from "@/lib/stables/webhook.server";

const BODY = JSON.stringify({
  event_id: "evt_1",
  event_type: "transfer.updated.status_transitioned",
});
const SVIX_KEY = Buffer.from("super-secret-signing-key-bytes!!");
const SVIX_SECRET = `whsec_${SVIX_KEY.toString("base64")}`;
const NOW_MS = 1_760_000_000_000;
const NOW_S = String(NOW_MS / 1000);

function svixHeaders(signature: string, timestamp = NOW_S, id = "msg_1") {
  return new Headers({ "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature });
}

function svixSign(body: string, timestamp = NOW_S, id = "msg_1") {
  return createHmac("sha256", SVIX_KEY).update(`${id}.${timestamp}.${body}`).digest("base64");
}

describe("verifyStablesWebhook — Svix", () => {
  it("accepts a valid signature", () => {
    const headers = svixHeaders(`v1,${svixSign(BODY)}`);
    expect(verifyStablesWebhook(BODY, headers, SVIX_SECRET, NOW_MS)).toEqual({ ok: true });
  });

  it("accepts any matching signature in a rotated list", () => {
    const headers = svixHeaders(`v1,${"A".repeat(44)} v1,${svixSign(BODY)}`);
    expect(verifyStablesWebhook(BODY, headers, SVIX_SECRET, NOW_MS).ok).toBe(true);
  });

  it("rejects a tampered body, wrong secret, or wrong message id", () => {
    const signature = `v1,${svixSign(BODY)}`;
    expect(verifyStablesWebhook(BODY + " ", svixHeaders(signature), SVIX_SECRET, NOW_MS).ok).toBe(
      false,
    );
    expect(verifyStablesWebhook(BODY, svixHeaders(signature), "whsec_b3RoZXI=", NOW_MS).ok).toBe(
      false,
    );
    expect(
      verifyStablesWebhook(BODY, svixHeaders(signature, NOW_S, "msg_2"), SVIX_SECRET, NOW_MS).ok,
    ).toBe(false);
  });

  it("rejects stale or future timestamps", () => {
    const old = String(NOW_MS / 1000 - 301);
    expect(
      verifyStablesWebhook(
        BODY,
        svixHeaders(`v1,${svixSign(BODY, old)}`, old),
        SVIX_SECRET,
        NOW_MS,
      ),
    ).toEqual({
      ok: false,
      reason: "Webhook timestamp is outside the allowed window.",
    });
    const future = String(NOW_MS / 1000 + 301);
    expect(
      verifyStablesWebhook(
        BODY,
        svixHeaders(`v1,${svixSign(BODY, future)}`, future),
        SVIX_SECRET,
        NOW_MS,
      ).ok,
    ).toBe(false);
  });

  it("rejects partial svix headers", () => {
    const headers = new Headers({ "svix-id": "msg_1", "svix-timestamp": NOW_S });
    expect(verifyStablesWebhook(BODY, headers, SVIX_SECRET, NOW_MS)).toEqual({
      ok: false,
      reason: "Missing svix signature headers.",
    });
  });
});

describe("verifyStablesWebhook — only Svix is accepted", () => {
  it("refuses X-Webhook-Signature deliveries even when the HMAC is right", () => {
    const secret = "subscription-secret";
    const digest = createHmac("sha256", secret).update(BODY).digest("hex");
    const headers = new Headers({ "X-Webhook-Signature": digest });
    expect(verifyStablesWebhook(BODY, headers, secret)).toEqual({
      ok: false,
      reason: "Missing svix signature headers.",
    });
  });

  it("refuses a delivery with no signature headers", () => {
    expect(verifyStablesWebhook(BODY, new Headers(), SVIX_SECRET).ok).toBe(false);
  });
});

describe("idempotencyKey", () => {
  it("is deterministic and UUID v4 shaped", () => {
    const key = idempotencyKey("payment-1", "transfer", "quote-1");
    expect(key).toBe(idempotencyKey("payment-1", "transfer", "quote-1"));
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("differs when any part differs, without concatenation collisions", () => {
    expect(idempotencyKey("payment-1", "transfer", "quote-2")).not.toBe(
      idempotencyKey("payment-1", "transfer", "quote-1"),
    );
    expect(idempotencyKey("ab", "c")).not.toBe(idempotencyKey("a", "bc"));
  });
});

describe("getStablesConfig", () => {
  const saved = { key: process.env["STABLES_API_KEY"], url: process.env["STABLES_API_URL"] };
  afterEach(() => {
    process.env["STABLES_API_KEY"] = saved.key ?? "";
    process.env["STABLES_API_URL"] = saved.url ?? "";
  });

  it("defaults to the sandbox", () => {
    process.env["STABLES_API_KEY"] = "sti_test_abc";
    process.env["STABLES_API_URL"] = "";
    expect(getStablesConfig()).toMatchObject({
      configured: true,
      environment: "sandbox",
      apiUrl: "https://api.sandbox.stables.money",
    });
  });

  it("is unconfigured without a key", () => {
    process.env["STABLES_API_KEY"] = "";
    expect(getStablesConfig().configured).toBe(false);
  });

  it("refuses key/environment mismatches", () => {
    process.env["STABLES_API_KEY"] = "sti_live_abc";
    process.env["STABLES_API_URL"] = "https://api.sandbox.stables.money";
    expect(getStablesConfig().configured).toBe(false);

    process.env["STABLES_API_KEY"] = "sti_test_abc";
    process.env["STABLES_API_URL"] = "https://api.stables.money";
    expect(getStablesConfig().configured).toBe(false);
  });

  it("detects production", () => {
    process.env["STABLES_API_KEY"] = "sti_live_abc";
    process.env["STABLES_API_URL"] = "https://api.stables.money/";
    expect(getStablesConfig()).toMatchObject({
      configured: true,
      environment: "production",
      apiUrl: "https://api.stables.money",
    });
  });
});
