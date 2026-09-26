import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { payoutError, payoutHeaders, getPayoutConfig } from "@/lib/payout.config";
import { authorizePayoutRequest } from "@/lib/payout.auth.server";

const QuoteInput = z
  .object({
    amount: z.string().min(1, "amount is required."),
    sourceCurrency: z.string().default("usdc"),
    destinationCurrency: z.string().min(1, "destinationCurrency is required."),
    paymentRail: z.string().min(1, "paymentRail is required."),
    onBehalfOf: z.string().min(1, "onBehalfOf is required."),
  })
  .strict();

function errorResponse(message: string, status: number, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status });
}

export const Route = createFileRoute("/api/payout/quote")({
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
            "Payout partner API is not configured. Add PAYOUT_API_KEY to enable real quotes.",
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

        const parsed = QuoteInput.safeParse(body);
        if (!parsed.success) {
          return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request.", 400);
        }

        const { amount, sourceCurrency, destinationCurrency, paymentRail, onBehalfOf } =
          parsed.data;
        const idempotencyKey = request.headers.get("Idempotency-Key") || crypto.randomUUID();

        // Payout does not expose a separate quote endpoint. We create a transfer
        // in preview/simulation shape so the receipt can be inspected without
        // moving funds. The destination is intentionally an external account
        // placeholder because the real quote depends on the recipient rail.
        const upstream = await fetch(`${config.apiUrl}/v0/transfers`, {
          method: "POST",
          headers: payoutHeaders(config, idempotencyKey),
          body: JSON.stringify({
            amount,
            on_behalf_of: onBehalfOf,
            source: { payment_rail: "payout_wallet", currency: sourceCurrency },
            destination: { payment_rail: paymentRail, currency: destinationCurrency },
          }),
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

        return Response.json({
          payoutMode: true,
          transfer: payload,
          amount,
          sourceCurrency,
          destinationCurrency,
          paymentRail,
        });
      },
    },
  },
});
