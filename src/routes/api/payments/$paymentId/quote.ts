import { createFileRoute } from "@tanstack/react-router";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { USER_LIMITS } from "@/lib/payments/rate-limit.server";
import { quotePayment } from "@/lib/payments/service.server";

/**
 * POST /api/payments/:paymentId/quote — fresh Stables quote (USDC on Solana →
 * local currency). Requires a verified customer with the base_payout
 * entitlement. Calling again replaces an unused quote.
 */
export const Route = createFileRoute("/api/payments/$paymentId/quote")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleUserRequest(
          request,
          undefined,
          async (user) => json(await quotePayment(user, params.paymentId)),
          USER_LIMITS.quote,
        ),
    },
  },
});
