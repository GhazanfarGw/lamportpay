import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { USER_LIMITS } from "@/lib/payments/rate-limit.server";
import { buildFundingTransaction } from "@/lib/payments/service.server";

const FundingTransactionInput = z.object({ payer: z.string().trim().min(32).max(44) }).strict();

/**
 * POST /api/payments/:paymentId/funding-transaction — unsigned transaction
 * sending the exact deposit amount of USDC from the user's wallet to the
 * Stables deposit address. The wallet signs and sends it; the server never
 * sees a key. Disabled in the Stables sandbox.
 */
export const Route = createFileRoute("/api/payments/$paymentId/funding-transaction")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleUserRequest(
          request,
          FundingTransactionInput,
          async (user, body) =>
            json(await buildFundingTransaction(user, params.paymentId, body.payer)),
          USER_LIMITS.funding,
        ),
    },
  },
});
