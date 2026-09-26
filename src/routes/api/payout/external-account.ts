import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { payoutError, payoutHeaders, getPayoutConfig } from "@/lib/payout.config";
import { authorizePayoutRequest } from "@/lib/payout.auth.server";

const ExternalAccountInput = z
  .object({
    customerId: z.string().min(1, "customerId is required."),
    currency: z.string().min(1, "currency is required."),
    account_number: z.string().min(1, "account_number is required."),
    routing_number: z.string().optional(),
    bank_name: z.string().optional(),
    account_holder_name: z.string().optional(),
    account_holder_type: z.enum(["individual", "business"]).default("individual"),
  })
  .strict();

function errorResponse(message: string, status: number, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status });
}

export const Route = createFileRoute("/api/payout/external-account")({
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
            "Payout partner API is not configured. Add PAYOUT_API_KEY to create real external accounts.",
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

        const parsed = ExternalAccountInput.safeParse(body);
        if (!parsed.success) {
          return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request.", 400);
        }

        const { customerId, ...account } = parsed.data;
        const idempotencyKey = request.headers.get("Idempotency-Key") || crypto.randomUUID();

        const upstream = await fetch(
          `${config.apiUrl}/v0/customers/${customerId}/external_accounts`,
          {
            method: "POST",
            headers: payoutHeaders(config, idempotencyKey),
            body: JSON.stringify({
              currency: account.currency,
              account_number: account.account_number,
              routing_number: account.routing_number,
              bank_name: account.bank_name,
              account_holder_name: account.account_holder_name,
              account_holder_type: account.account_holder_type,
            }),
          },
        );

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

        return Response.json({ payoutMode: true, externalAccount: payload });
      },
    },
  },
});
