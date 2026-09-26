import { createFileRoute } from "@tanstack/react-router";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { getPaymentView } from "@/lib/payments/service.server";

/** GET /api/payments/:paymentId — status, amounts, deposit instructions, timeline. */
export const Route = createFileRoute("/api/payments/$paymentId/")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleUserRequest(request, undefined, async (user) =>
          json(await getPaymentView(user, params.paymentId)),
        ),
    },
  },
});
