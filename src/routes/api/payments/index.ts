import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { createPayment } from "@/lib/payments/service.server";

const CreatePaymentInput = z
  .object({
    amount: z
      .string()
      .trim()
      .regex(/^\d+(\.\d+)?$/, "Amount must be a decimal number."),
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, "Country must be a 2-letter code."),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code."),
  })
  .strict();

/**
 * POST /api/payments — start a USDC → local-currency bank payout. Stables
 * prices the destination first; a 422 `destination_not_supported` means it
 * will not pay out there (its wording is in `reason`).
 */
export const Route = createFileRoute("/api/payments/")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleUserRequest(request, CreatePaymentInput, async (user, body) =>
          json(await createPayment(user, body), 201),
        ),
    },
  },
});
