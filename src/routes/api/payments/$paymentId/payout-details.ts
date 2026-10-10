import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { BeneficiarySchema } from "@/lib/payments/beneficiary-schema";
import { checkPayoutDetails } from "@/lib/payments/service.server";

const Input = z
  .object({
    beneficiary: BeneficiarySchema,
    /** The user's own name, new customers only; a verified customer's verified name always wins. */
    holderName: z.string().trim().min(3).max(140).optional(),
  })
  .strict();

/**
 * POST /api/payments/:paymentId/payout-details — check the payout bank
 * details with Stables (its per-currency rules) before verification and before
 * anything is created. Nothing is stored but a masked audit event; the full
 * details go to Stables again, once, when the user presses Pay Now.
 */
export const Route = createFileRoute("/api/payments/$paymentId/payout-details")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleUserRequest(request, Input, async (user, body) =>
          json(await checkPayoutDetails(user, params.paymentId, body)),
        ),
    },
  },
});
