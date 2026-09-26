#!/usr/bin/env node
/**
 * Send a Svix-signed Stables webhook event to a LamportPay server, for local
 * and sandbox testing. Signs with STABLES_WEBHOOK_SECRET read from .env /
 * .env.local with the dev server's precedence (.env.local wins). The secret is
 * never printed.
 *
 *   npm run webhook:send -- travel-rule <reference> [--expires-in <minutes>] [--verification-url <url>]
 *   npm run webhook:send -- transfer <transfer_id> <STATUS>
 *   npm run webhook:send -- kyc <customer_id> <VERIFICATION_STATUS>
 *   npm run webhook:send -- customer-created|customer-updated <customer_id>
 *   npm run webhook:send -- unknown
 *
 * Options: --url <base or full endpoint URL> (default http://localhost:8080)
 */
import { createHmac, randomUUID } from "node:crypto";
import { loadEnv } from "vite";

const ENDPOINT_PATH = "/api/public/stables-webhook";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { positional, flags };
}

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    [
      "Usage:",
      "  npm run webhook:send -- travel-rule <reference> [--expires-in <minutes>] [--verification-url <url>]",
      "  npm run webhook:send -- transfer <transfer_id> <STATUS>",
      "  npm run webhook:send -- kyc <customer_id> <VERIFICATION_STATUS>",
      "  npm run webhook:send -- customer-created|customer-updated <customer_id>",
      "  npm run webhook:send -- unknown",
      "Options: --url <base or endpoint URL> (default http://localhost:8080)",
    ].join("\n"),
  );
  process.exit(1);
}

function envelope(category, type, objectId, object, status) {
  return {
    api_version: "v1",
    event_id: randomUUID(),
    event_category: category,
    event_type: type,
    event_object_id: objectId,
    ...(status && { event_object_status: status }),
    event_object: object,
    event_created_at: new Date().toISOString(),
  };
}

function buildEvent(kind, args, flags) {
  const now = new Date().toISOString();
  switch (kind) {
    case "travel-rule": {
      const [reference] = args;
      if (!reference) usage("travel-rule needs a reference (transfer ID or deposit signature).");
      const minutes = Number(flags["expires-in"] ?? 24 * 60);
      if (!Number.isFinite(minutes)) usage("--expires-in must be a number of minutes.");
      return envelope("travel_rule", "travel_rule.wallet_verification_required", reference, {
        transaction_reference_id: reference,
        verification_url:
          flags["verification-url"] ??
          `https://verify.example.com/payment-sources/confirm?token=${randomUUID()}`,
        expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
      });
    }
    case "transfer": {
      const [transferId, status] = args;
      if (!transferId || !status) usage("transfer needs <transfer_id> <STATUS>.");
      const upper = status.toUpperCase();
      return envelope(
        "transfer",
        "transfer.updated.status_transitioned",
        transferId,
        { transfer_id: transferId, type: "TRANSFER_TYPE_OFFRAMP", status: upper, updated_at: now },
        upper,
      );
    }
    case "kyc": {
      const [customerId, status] = args;
      if (!customerId || !status) usage("kyc needs <customer_id> <VERIFICATION_STATUS>.");
      const upper = status.toUpperCase();
      return envelope(
        "kyc_link",
        "kyc_link.updated.status_transitioned",
        randomUUID(),
        { kyc_link_id: randomUUID(), customer_id: customerId, status: upper, updated_at: now },
        upper,
      );
    }
    case "customer-created":
    case "customer-updated": {
      const [customerId] = args;
      if (!customerId) usage(`${kind} needs <customer_id>.`);
      return envelope("customer", kind.replace("-", "."), customerId, {
        customer_id: customerId,
        customer_type: "CUSTOMER_TYPE_INDIVIDUAL",
        created_at: now,
        updated_at: now,
      });
    }
    case "unknown":
      return envelope("virtual_account", "virtual_account.created", randomUUID(), {});
    default:
      return usage(kind ? `unknown event kind "${kind}".` : undefined);
  }
}

function endpoint(raw) {
  const url = new URL(raw ?? "http://localhost:8080");
  if (url.pathname === "/" || url.pathname === "") url.pathname = ENDPOINT_PATH;
  return url;
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [kind, ...args] = positional;
const event = buildEvent(kind, args, flags);

const secret = loadEnv("development", process.cwd(), "")["STABLES_WEBHOOK_SECRET"]?.trim();
if (!secret) usage("STABLES_WEBHOOK_SECRET is not set in .env.local (or .env).");

const body = JSON.stringify(event);
const id = `msg_${randomUUID().replace(/-/g, "")}`;
const timestamp = String(Math.floor(Date.now() / 1000));
const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");

const url = endpoint(flags["url"]);
const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  },
  body,
});

console.log(`${event.event_type} (event_id ${event.event_id}) → ${url.href}`);
console.log(`HTTP ${response.status} ${await response.text()}`);
if (!response.ok) process.exit(2);
