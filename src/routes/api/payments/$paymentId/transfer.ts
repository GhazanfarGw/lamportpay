import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { BeneficiarySchema } from "@/lib/payments/beneficiary-schema";
import { handleUserRequest, json } from "@/lib/payments/http.server";
import { USER_LIMITS } from "@/lib/payments/rate-limit.server";
import { createPaymentTransfer } from "@/lib/payments/service.server";
import { PURPOSE_CODES } from "@/lib/stables/types";

const TransferInput = z
  .object({
    purposeCode: z.enum(PURPOSE_CODES).default("TRANSFER_TO_OWN_ACCOUNT"),
    // The user's own account only: the holder is named from the approved
    // Stables customer record, never from the browser.
    beneficiary: BeneficiarySchema,
  })
  .strict();

/**
 * POST /api/payments/:paymentId/transfer — validate the user's own bank
 * details with Stables (the destination's own rules), then create the Stables
 * transfer for the current quote. Needs a verified customer (checked live).
 * The response carries the single-use deposit address the user sends USDC/USDT
 * to. A 422 with `fields` names what Stables needs. Bank details are forwarded
 * to Stables and only a masked summary is stored.
 */
export const Route = createFileRoute("/api/payments/$paymentId/transfer")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleUserRequest(
          request,
          TransferInput,
          async (user, body) => json(await createPaymentTransfer(user, params.paymentId, body)),
          USER_LIMITS.transfer,
        ),
    },
  },
});
