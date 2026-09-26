import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { payoutError, payoutHeaders, getPayoutConfig } from "@/lib/payout.config";
import { authorizePayoutRequest } from "@/lib/payout.auth.server";

const CustomerInput = z
  .object({
    type: z.enum(["individual", "business"]).default("individual"),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    email: z.string().email().optional(),
  })
  .strict();

function errorResponse(message: string, status: number, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status });
}

export const Route = createFileRoute("/api/payout/customer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = authorizePayoutRequest(request);
        if (auth.denied) {
          return auth.denied;
        }

        const config = getPayoutConfig();
        if (!config.enabled) {
          return errorResponse(
            "Payout partner API is not configured. Add PAYOUT_API_KEY to create real customers.",
            200,
            { demoMode: true },
          );
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Invalid JSON body.", 400);
        }

        const parsed = CustomerInput.safeParse(body);
        if (!parsed.success) {
          return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request.", 400);
        }

        const idempotencyKey = request.headers.get("Idempotency-Key") || crypto.randomUUID();

        const upstream = await fetch(`${config.apiUrl}/v0/customers`, {
          method: "POST",
          headers: payoutHeaders(config, idempotencyKey),
          body: JSON.stringify(parsed.data),
        });

        const text = await upstream.text();
        if (!upstream.ok) {
          return errorResponse(payoutError(upstream.status, text).error, 502, {
            payoutStatus: upstream.status,
            payoutRaw: text,
          });
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(text);
        } catch {
          return errorResponse("Invalid response from Payout partner API.", 502);
        }

        return Response.json({ payoutMode: true, customer: payload });
      },
    },
  },
});
