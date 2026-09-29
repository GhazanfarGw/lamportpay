import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { authenticateUser } from "@/lib/payments/auth.server";
import {
  buildRoutePreview,
  hasRoute,
  readJupiterError,
  type JupiterOrderPayload,
} from "@/lib/swap-route";
import { SOL_MINT, USDC_MINT, isSupportedInputMint } from "@/lib/tokens";
import { currentSwapReferral } from "@/lib/jupiter/referral.server";

// Read-only route preview for a signed-in user. No taker, no transaction, no
// signing. Same safety limits as the real order endpoint, and no mock
// fallback: when Jupiter can't route, the caller gets the error.
const MIN_LAMPORTS = 1_000_000; // 0.001 SOL
const MAX_LAMPORTS = 10_000_000; // 0.01 SOL

const QuoteInput = z
  .object({
    inputMint: z.string().default(SOL_MINT),
    outputMint: z.string().default(USDC_MINT),
    amount: z
      .string()
      .nonempty("amount is required (lamports as a string).")
      .min(1, "amount is required.")
      .regex(/^\d+$/, "amount must be a numeric string in lamports."),
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
async function requireUser(request: Request): Promise<Response | null> {
  try {
    const auth = await authenticateUser(request);
    if (!auth.denied) return null;
    auth.denied.headers.set("Cache-Control", "no-store");
    return auth.denied;
  } catch (error) {
    console.error("[jupiter] sign-in check failed", error);
    return errorResponse("Sign-in could not be checked. Try again shortly.", 503);
  }
}

export const Route = createFileRoute("/api/jupiter/quote")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireUser(request);
        if (denied) return denied;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Invalid JSON body.", 400);
        }

        const parsed = QuoteInput.safeParse(body);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          const msg =
            issue?.code === "unrecognized_keys"
              ? "Unexpected fields in request. Only inputMint, outputMint and amount are allowed."
              : (issue?.message ?? "Invalid request.");
          return errorResponse(msg, 400);
        }

        const { inputMint, outputMint, amount } = parsed.data;
        if (!isSupportedInputMint(inputMint)) {
          return errorResponse("Unsupported inputMint. Only SOL is supported.", 400);
        }
        if (outputMint !== USDC_MINT) {
          return errorResponse("Unsupported outputMint. Only USDC is supported.", 400);
        }

        const lamports = Number(amount);
        if (!Number.isFinite(lamports) || lamports < MIN_LAMPORTS) {
          return errorResponse("Minimum preview amount is 0.001 SOL.", 400);
        }
        if (lamports > MAX_LAMPORTS) {
          return errorResponse("Maximum preview amount is 0.01 SOL.", 400);
        }

        const apiKey = process.env["JUPITER_API_KEY"];
        if (!apiKey) return errorResponse("Swaps are not configured.", 503);

        const url = new URL("https://api.jup.ag/swap/v2/order");
        url.searchParams.set("inputMint", SOL_MINT);
        url.searchParams.set("outputMint", USDC_MINT);
        url.searchParams.set("amount", amount);
        // Same integrator fee as the order, so the preview matches what is signed.
        let referral;
        try {
          referral = await currentSwapReferral();
        } catch {
          return errorResponse("Swaps are temporarily unavailable.", 503);
        }
        if (referral) {
          url.searchParams.set("referralAccount", referral.account);
          url.searchParams.set("referralFee", String(referral.feeBps));
        }

        let upstream: Response;
        try {
          upstream = await fetch(url, {
            headers: { "x-api-key": apiKey, Accept: "application/json" },
            signal: AbortSignal.timeout(15_000),
          });
        } catch {
          return errorResponse("Could not reach Jupiter. Try again shortly.", 502);
        }

        let payload: JupiterOrderPayload;
        try {
          payload = (await upstream.json()) as JupiterOrderPayload;
        } catch {
          return errorResponse("Invalid response from Jupiter.", 502);
        }

        // Jupiter reports some failures as HTTP 200 with an error field.
        if (!upstream.ok || !hasRoute(payload)) {
          const reason =
            readJupiterError(payload) ??
            (upstream.ok ? "Jupiter returned no route." : `Jupiter error (${upstream.status}).`);
          return errorResponse(reason, 502);
        }

        return json(buildRoutePreview(amount, SOL_MINT, USDC_MINT, payload));
      },
    },
  },
});
