import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { confirmTestPayment } from "@/lib/payments/test-payment.server";

const Input = z.object({ signature: z.string().trim().min(64).max(96) }).strict();

/**
 * POST /api/payments/:paymentId/test-payment — TEST MODE only. Verifies the
 * user's signed devnet memo transaction for this payment (moves no funds) and
 * then simulates the deposit in the Stables sandbox. Refused in LIVE MODE.
 */
export const Route = createFileRoute("/api/payments/$paymentId/test-payment")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleUserRequest(request, Input, async (user, body) =>
          json(await confirmTestPayment(user, params.paymentId, body.signature)),
        ),
    },
  },
});
