import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ModeGuardError } from "@/lib/app-mode.server";
import { JupiterError } from "@/lib/jupiter/client.server";
import { SwapOrderError, relaySwapOrder } from "@/lib/jupiter/swap-orders.server";
import { authenticateUser } from "@/lib/payments/auth.server";

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const ExecuteInput = z
  .object({
    signedTransaction: z
      .string({ error: "signedTransaction is required." })
      .min(1, "signedTransaction is required.")
      .refine((v) => v.length % 4 === 0 && BASE64_RE.test(v), {
        message: "signedTransaction must be a base64 string.",
      }),
    requestId: z.string({ error: "requestId is required." }).min(1, "requestId is required."),
    lastValidBlockHeight: z.union([z.string(), z.number()]).optional(),
  })
  // Never accept key material — reject any extra fields outright.
  .strict();

const FORBIDDEN_KEY_FIELDS = [
  "privateKey",
  "private_key",
  "secretKey",
  "secret_key",
  "seedPhrase",
  "seed_phrase",
  "mnemonic",
] as const;

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

function errorResponse(message: string, status: number) {
  return json({ error: message }, status);
}

/** The signed-in user, or the 401 to send back. Anonymous callers never reach Jupiter. */
async function requireUser(
  request: Request,
): Promise<{ userId: string; denied: null } | { userId: null; denied: Response }> {
  try {
    const auth = await authenticateUser(request);
    if (!auth.denied) return { userId: auth.user.id, denied: null };
    auth.denied.headers.set("Cache-Control", "no-store");
    return { userId: null, denied: auth.denied };
  } catch (error) {
    console.error("[jupiter] sign-in check failed", error);
    return {
      userId: null,
      denied: errorResponse("Sign-in could not be checked. Try again shortly.", 503),
    };
  }
}

/** A Jupiter or swap-order failure as an HTTP answer; Jupiter's own refusals are 502. */
function failure(e: unknown): Response {
  if (e instanceof ModeGuardError) return errorResponse(e.message, 403);
  if (e instanceof SwapOrderError) return errorResponse(e.message, e.status);
  if (e instanceof JupiterError) {
    return errorResponse(e.message, e.status === 422 ? 502 : e.status);
  }
  console.error("[jupiter] unexpected failure", e);
  return errorResponse("Swap service error. Try again shortly.", 500);
}

export const Route = createFileRoute("/api/jupiter/execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth.denied) return auth.denied;
        const userId = auth.userId;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Invalid JSON body.", 400);
        }

        if (body && typeof body === "object" && !Array.isArray(body)) {
          const keys = Object.keys(body as Record<string, unknown>);
          const blocked = keys.filter((key) =>
            (FORBIDDEN_KEY_FIELDS as readonly string[]).includes(key),
          );
          if (blocked.length > 0) {
            return errorResponse(
              `Private key or seed phrase fields are not allowed. Remove: ${blocked.join(", ")}.`,
              400,
            );
          }
        }

        const parsed = ExecuteInput.safeParse(body);
        if (!parsed.success) {
          return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request.", 400);
        }

        if (!process.env["JUPITER_API_KEY"]) return errorResponse("Swaps are not configured.", 503);

        // Relays only a transaction for an order this user was issued by
        // /api/jupiter/order, with that order's exact message, signed by its
        // taker, never twice. The server never signs.
        const { signedTransaction, requestId } = parsed.data;
        try {
          const result = await relaySwapOrder({ userId, requestId, signedTransaction });
          if (result.status === "Failed") {
            return json(
              {
                error:
                  result.error ??
                  `Jupiter reported the swap as failed${result.code !== null ? ` (code ${result.code})` : ""}.`,
                signature: result.signature,
              },
              502,
            );
          }
          return json({
            status: result.status,
            signature: result.signature,
            totalInputAmount: null,
            totalOutputAmount: result.outputAmountResult?.toString() ?? null,
            inputAmountResult: result.inputAmountResult?.toString() ?? null,
            outputAmountResult: result.outputAmountResult?.toString() ?? null,
            error: null,
          });
        } catch (e) {
          return failure(e);
        }
      },
    },
  },
});
