import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import { runAfterResponse } from "@/lib/after-response.server";
import { claimWebhookEvent } from "@/lib/payments/ledger.server";
import { processWebhookEvent } from "@/lib/payments/service.server";
import { getStablesWebhookSecret } from "@/lib/stables/config.server";
import type { StablesWebhookEvent } from "@/lib/stables/types";
import { hasSvixHeaders, verifyStablesWebhook } from "@/lib/stables/webhook.server";

// Only what every event type shares is required: an event type we do not
// handle (or one Stables adds later) must still be stored and acknowledged.
const Envelope = z
  .object({ event_id: z.string().min(1), event_type: z.string().min(1) })
  .passthrough();

const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

const optionalString = (value: unknown) => (typeof value === "string" ? value : undefined);

function toEvent(payload: z.infer<typeof Envelope>): StablesWebhookEvent {
  const object = payload["event_object"];
  return {
    ...(payload as unknown as StablesWebhookEvent),
    event_object_id: optionalString(payload["event_object_id"]) as string,
    event_object_status: optionalString(payload["event_object_status"]),
    event_created_at: optionalString(payload["event_created_at"]) as string,
    event_object:
      object && typeof object === "object" && !Array.isArray(object)
        ? (object as Record<string, unknown>)
        : {},
  };
}

/**
 * POST /api/public/stables-webhook (dashboard-managed endpoint, Svix-signed)
 *
 * Verifies the Svix signature against the raw body, stores the delivery
 * (deduplicated by event_id) and acknowledges with 200 straight away; the
 * event is applied after the response. Storing first means a delivery is never
 * lost: anything left unprocessed is retried by the reconciliation job. Only a
 * failure to store it answers 5xx, so Stables retries.
 *
 * 401: no or invalid signature. 503: signed, but no secret is configured to
 * check it (Stables retries, so nothing is lost while the secret is missing).
 */
export const Route = createFileRoute("/api/public/stables-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!hasSvixHeaders(request.headers)) {
          return reply({ error: "Missing svix signature headers." }, 401);
        }
        const secret = getStablesWebhookSecret();
        // Without a secret no event can be authenticated: refuse rather than trust it.
        if (!secret) return reply({ error: "Webhook verification is not configured." }, 503);

        const rawBody = await request.text();
        const verification = verifyStablesWebhook(rawBody, request.headers, secret);
        if (!verification.ok) return reply({ error: verification.reason }, 401);

        let payload: z.infer<typeof Envelope>;
        try {
          const result = Envelope.safeParse(JSON.parse(rawBody));
          if (!result.success) return reply({ error: "Unexpected event shape." }, 400);
          payload = result.data;
        } catch {
          return reply({ error: "Invalid JSON body." }, 400);
        }
        const event = toEvent(payload);

        let claim: Awaited<ReturnType<typeof claimWebhookEvent>>;
        try {
          claim = await claimWebhookEvent({
            event_id: event.event_id,
            event_type: event.event_type,
            event_object_id: event.event_object_id ?? null,
            event_object_status: event.event_object_status ?? null,
            payload: payload as unknown as Json,
          });
        } catch (error) {
          console.error(`[stables-webhook] could not store ${event.event_id}`, error);
          return reply({ error: "Could not store the event." }, 500);
        }
        if (claim === "duplicate") return reply({ received: true, duplicate: true });

        runAfterResponse(request, processWebhookEvent(event));
        return reply({ received: true });
      },
    },
  },
});
