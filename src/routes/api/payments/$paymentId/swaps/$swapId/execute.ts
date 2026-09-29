import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { executeSwap } from "@/lib/payments/swaps.server";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Strict: key material or any other field is refused outright.
const ExecuteInput = z
  .object({
    signedTransaction: z
      .string()
      .min(1)
      .max(2000)
      .refine((v) => v.length % 4 === 0 && BASE64.test(v), "signedTransaction must be base64."),
  })
  .strict();

/**
 * POST /api/payments/:paymentId/swaps/:swapId/execute — relay the user-signed
 * swap. Relayed only if its message is exactly the stored order's and the
 * user's wallet signed it; never relayed twice.
 */
export const Route = createFileRoute("/api/payments/$paymentId/swaps/$swapId/execute")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleUserRequest(request, ExecuteInput, async (user, body) =>
          json(await executeSwap(user, params.paymentId, params.swapId, body.signedTransaction)),
        ),
    },
  },
});
