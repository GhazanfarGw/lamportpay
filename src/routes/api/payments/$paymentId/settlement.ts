import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { recheckSettlement } from "@/lib/payments/service.server";
import { PAYMENT_CURRENCIES } from "@/lib/tokens";

const SettlementInput = z
  .object({
    /** Public key of the connected wallet (connecting is not signing). */
    wallet: z
      .string()
      .trim()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "wallet must be a Solana address.")
      .optional(),
    preferredCurrency: z.enum(["auto", ...PAYMENT_CURRENCIES]).optional(),
  })
  .strict();

/**
 * POST /api/payments/:paymentId/settlement — check again which coin pays
 * (after connecting or topping up a wallet). Only before the quote and before
 * any swap; at most once every few seconds.
 */
export const Route = createFileRoute("/api/payments/$paymentId/settlement")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleUserRequest(request, SettlementInput, async (user, body) =>
          json(await recheckSettlement(user, params.paymentId, body)),
        ),
    },
  },
});
