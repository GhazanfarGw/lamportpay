import { createFileRoute } from "@tanstack/react-router";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { confirmSwap } from "@/lib/payments/swaps.server";

/**
 * POST /api/payments/:paymentId/swaps/:swapId/confirm — the swap's outcome from
 * the chain at finalized commitment. 202 while it is not final yet.
 */
export const Route = createFileRoute("/api/payments/$paymentId/swaps/$swapId/confirm")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleUserRequest(request, undefined, async (user) => {
          const result = await confirmSwap(user, params.paymentId, params.swapId);
          return json(result, result.pending ? 202 : 200);
        }),
    },
  },
});
