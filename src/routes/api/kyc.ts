import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { USER_LIMITS } from "@/lib/payments/rate-limit.server";
import { getKycStatus, startKyc } from "@/lib/payments/service.server";

const StartKycInput = z
  .object({
    firstName: z.string().trim().max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    /** Only for accounts without an email (wallet sign-in); used once, for the partner. */
    email: z.string().trim().toLowerCase().email().max(254).optional(),
  })
  .strict();

/**
 * GET  /api/kyc — the signed-in user's Stables verification status.
 * POST /api/kyc — create the Stables customer (first time) and return a
 *                 hosted KYC link. LamportPay never sees identity documents.
 */
export const Route = createFileRoute("/api/kyc")({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleUserRequest(request, undefined, async (user) => json(await getKycStatus(user))),

      POST: ({ request }) =>
        handleUserRequest(
          request,
          StartKycInput,
          async (user, body) => {
            const returnUrl = new URL("/pay?kyc=returned", request.url).toString();
            return json(await startKyc(user, { ...body, returnUrl }));
          },
          USER_LIMITS.kyc,
        ),
    },
  },
});
