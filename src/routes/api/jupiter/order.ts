import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { JupiterError } from "@/lib/jupiter/client.server";
import { SwapOrderError, issueSwapOrder } from "@/lib/jupiter/swap-orders.server";
import { authenticateUser } from "@/lib/payments/auth.server";
import { USDC_MINT, isSupportedInputMint } from "@/lib/tokens";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Safety limits for the real-swap demo (lamports).
const MIN_LAMPORTS = 1_000_000; // 0.001 SOL
const MAX_LAMPORTS = 10_000_000; // 0.01 SOL

// Destination Verification Guard: any field that could redirect swap output
// away from the connected wallet is rejected outright.
const FORBIDDEN_FIELDS = [
  "receiver",
  "destinationTokenAccount",
  "payer",
  "referralAccount",
  "referralTokenAccount",
  "feeAccount",
  "platformFeeBps",
  "recipient",
  "merchantWallet",
  "payoutWallet",
] as const;

const OrderInput = z
  .object({
    inputMint: z.string().min(1, "inputMint is required."),
    outputMint: z.string().min(1, "outputMint is required."),
    amount: z
      .string()
      .min(1, "amount is required.")
      .regex(/^\d+$/, "amount must be a numeric string in the smallest token unit."),
    taker: z
      .string()
      .min(1, "taker is required.")
      .regex(BASE58_RE, "taker must be a valid Solana wallet address."),
  })
  .strict();

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
  if (e instanceof SwapOrderError) return errorResponse(e.message, e.status);
  if (e instanceof JupiterError) {
    return errorResponse(e.message, e.status === 422 ? 502 : e.status);
  }
  console.error("[jupiter] unexpected failure", e);
  return errorResponse("Swap service error. Try again shortly.", 500);
}

export const Route = createFileRoute("/api/jupiter/order")({
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
          const blocked = keys.filter((k) => (FORBIDDEN_FIELDS as readonly string[]).includes(k));
          if (blocked.length > 0) {
            return errorResponse(
              `Destination override is not allowed. Remove: ${blocked.join(", ")}.`,
              400,
            );
          }
        }

        const parsed = OrderInput.safeParse(body);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          const msg =
            issue?.code === "unrecognized_keys"
              ? "Unexpected fields in request. Only inputMint, outputMint, amount and taker are allowed."
              : (issue?.message ?? "Invalid request.");
          return errorResponse(msg, 400);
        }

        const { inputMint, outputMint, amount, taker } = parsed.data;

        if (!isSupportedInputMint(inputMint)) {
          return errorResponse("Unsupported inputMint. Only SOL is supported.", 400);
        }
        if (outputMint !== USDC_MINT) {
          return errorResponse("Unsupported outputMint. Only USDC is supported.", 400);
        }

        const lamports = Number(amount);
        if (!Number.isFinite(lamports) || lamports < MIN_LAMPORTS) {
          return errorResponse("Minimum test amount is 0.001 SOL.", 400);
        }
        if (lamports > MAX_LAMPORTS) {
          return errorResponse("Maximum demo swap amount is 0.01 SOL.", 400);
        }

        if (!process.env["JUPITER_API_KEY"]) return errorResponse("Swaps are not configured.", 503);

        // Always SOL in, USDC out, output owner = the connected wallet (taker).
        // The order is stored for this user; /execute relays only what was issued here.
        try {
          return json(await issueSwapOrder({ userId, taker, lamports: BigInt(amount) }));
        } catch (e) {
          return failure(e);
        }
      },
    },
  },
});
