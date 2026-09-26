import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { verifyFunding } from "@/lib/payments/service.server";

const FundingInput = z
  .object({
    signature: z.string().trim().min(64).max(96),
    // The sending wallet, when no funding transaction was prepared for it.
    payer: z.string().trim().min(32).max(44).optional(),
  })
  .strict();

/**
 * POST /api/payments/:paymentId/funding — record the Solana transaction that
 * paid the deposit address after verifying it on mainnet: finalized, USDC by
 * mint, exactly the deposit amount, to this payment's deposit address, sent
 * and signed by the payment's payer wallet. Returns 202 while the transaction
 * is not finalized yet; retry after a few seconds. Stables webhooks, not this
 * call, move the payment forward.
 */
export const Route = createFileRoute("/api/payments/$paymentId/funding")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleUserRequest(request, FundingInput, async (user, body) => {
          const result = await verifyFunding(user, params.paymentId, body.signature, body.payer);
          return result.pending ? json({ pending: true }, 202) : json(result.payment);
        }),
    },
  },
});
