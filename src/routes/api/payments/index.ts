import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { USER_LIMITS } from "@/lib/payments/rate-limit.server";
import { createPayment, listPayments } from "@/lib/payments/service.server";
import { PAYMENT_CURRENCIES } from "@/lib/tokens";

const CreatePaymentInput = z
  .object({
    amount: z
      .string()
      .trim()
      .regex(/^\d+(\.\d+)?$/, "Amount must be a decimal number."),
    /**
     * "auto" (the default): LamportPay picks the coin from what Stables prices
     * and what the wallet holds. A coin is a preference among coins the wallet
     * already holds; it never causes a swap.
     */
    preferredCurrency: z.enum(["auto", ...PAYMENT_CURRENCIES]).optional(),
    /** Older name for a preferred coin. */
    sourceCurrency: z.enum(PAYMENT_CURRENCIES).optional(),
    /** Public key of the connected wallet (connecting is not signing). */
    wallet: z
      .string()
      .trim()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "wallet must be a Solana address.")
      .optional(),
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
 * GET  /api/payments — the signed-in user's payment history, newest first.
 * POST /api/payments — start a USDC/USDT → local-currency bank payout. Stables
 * prices every coin first; a 422 `destination_not_supported` means it will not
 * pay out there, `amount_rejected` that it refuses the amount (its wording is
 * in `reason` either way). The response carries the settlement choice.
 */
export const Route = createFileRoute("/api/payments/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleUserRequest(request, undefined, async (user) => json(await listPayments(user))),
      POST: ({ request }) =>
        handleUserRequest(
          request,
          CreatePaymentInput,
          async (user, body) => json(await createPayment(user, body), 201),
          USER_LIMITS.createPayment,
        ),
    },
  },
});
