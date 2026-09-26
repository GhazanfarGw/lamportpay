import { createFileRoute } from "@tanstack/react-router";

import { getPayoutConfig } from "@/lib/payout.config";

interface WebhookSignature {
  timestamp: string;
  signature: string;
}

function parseSignatureHeader(header: string): WebhookSignature | null {
  const parts = header.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.split("=")[1];
  const signature = parts.find((p) => p.startsWith("v0="))?.split("=")[1];
  if (!timestamp || !signature) return null;
  return { timestamp, signature };
}

async function importRsaPublicKey(pem: string): Promise<CryptoKey> {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "spki",
    binary.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function verifyWebhookSignature(
  payload: string,
  header: string,
  publicKeyPem: string,
): Promise<boolean> {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;

  const now = Date.now();
  const timestamp = Number(parsed.timestamp);
  if (!Number.isFinite(timestamp) || now - timestamp > 10 * 60 * 1000) {
    return false;
  }

  try {
    const key = await importRsaPublicKey(publicKeyPem);
    const signedPayload = new TextEncoder().encode(`${parsed.timestamp}.${payload}`);
    const signature = Uint8Array.from(atob(parsed.signature), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature.buffer, signedPayload);
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/payout-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const config = getPayoutConfig();
        const signatureHeader = request.headers.get("X-Webhook-Signature");

        if (!signatureHeader) {
          return Response.json({ error: "Missing X-Webhook-Signature header." }, { status: 400 });
        }

        const body = await request.text();

        if (config.webhookSecret) {
          const valid = await verifyWebhookSignature(body, signatureHeader, config.webhookSecret);
          if (!valid) {
            return Response.json({ error: "Invalid webhook signature." }, { status: 400 });
          }
        }

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(body);
        } catch {
          return Response.json({ error: "Invalid JSON body." }, { status: 400 });
        }

        // In a production app, this would update the payment record in the database.
        // LamportPay currently has no database, so we acknowledge receipt and echo
        // the event for visibility.
        console.log("[payout-webhook] received event", JSON.stringify(event));

        return Response.json({ received: true, eventType: event.event_type ?? "unknown" });
      },
    },
  },
});
