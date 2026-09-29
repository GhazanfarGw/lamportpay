import { createFileRoute } from "@tanstack/react-router";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { orderSwap } from "@/lib/payments/swaps.server";

/**
 * POST /api/payments/:paymentId/swaps — order a swap of the missing amount into
 * the payment's coin, in the user's own wallet. The client sends nothing: the
 * server decides mints, amounts and wallet from fresh reads. Returns an
 * unsigned transaction for the wallet to sign. Mainnet only.
 */
export const Route = createFileRoute("/api/payments/$paymentId/swaps/")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleUserRequest(request, undefined, async (user) =>
          json(await orderSwap(user, params.paymentId), 201),
        ),
    },
  },
});
