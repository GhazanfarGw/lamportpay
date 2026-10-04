import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { handlePublicRequest, json } from "@/lib/payments/http.server";
import { liveEstimate } from "@/lib/payments/live-estimate.server";
import { PAYMENT_CURRENCIES } from "@/lib/tokens";

const EstimateInput = z
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
    coin: z.enum(PAYMENT_CURRENCIES),
    withSol: z.boolean().optional(),
    /** "sol": `amount` is SOL, priced into the coin by a read-only Jupiter quote. */
    payWith: z.enum([...PAYMENT_CURRENCIES, "sol"]).optional(),
  })
  .strict();

/**
 * POST /api/quote/estimate — live, read-only calculator for /pay: a Stables
 * preview quote (rate, partner fees, amount received), LamportPay's fee and,
 * the SOL side through a read-only Jupiter quote (SOL cost of the total, or —
 * with payWith "sol" — what a SOL amount buys). Public (the /pay calculator works signed out), rate limited per user / IP; no
 * wallet needed; nothing is created, stored or signed.
 */
export const Route = createFileRoute("/api/quote/estimate")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handlePublicRequest(request, EstimateInput, "estimate", 30, async (_user, body) =>
          json(await liveEstimate({ ...body, withSol: body.withSol ?? false })),
        ),
    },
  },
});
