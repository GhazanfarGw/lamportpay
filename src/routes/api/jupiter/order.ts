import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { SOL_MINT, USDC_MINT, isSupportedInputMint } from "@/lib/tokens";

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

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const Route = createFileRoute("/api/jupiter/order")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.JUPITER_API_KEY;
        if (!apiKey) return errorResponse("Missing Jupiter API key.", 500);

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

        const url = new URL("https://api.jup.ag/swap/v2/order");
        // Always forced: SOL in, USDC out, output owner = the connected wallet (taker).
        url.searchParams.set("inputMint", SOL_MINT);
        url.searchParams.set("outputMint", USDC_MINT);
        url.searchParams.set("amount", amount);
        url.searchParams.set("taker", taker);

        let upstream: Response;
        try {
          upstream = await fetch(url, {
            headers: { "x-api-key": apiKey, Accept: "application/json" },
          });
        } catch {
          return errorResponse("Failed to reach Jupiter API.", 502);
        }

        let payload: {
          transaction?: string;
          requestId?: string;
          outAmount?: string;
          lastValidBlockHeight?: number;
          error?: string;
        };
        try {
          payload = (await upstream.json()) as typeof payload;
        } catch {
          return errorResponse("Invalid response from Jupiter API.", 502);
        }

        if (!upstream.ok) {
          return errorResponse(payload?.error ?? `Jupiter API error (${upstream.status}).`, 502);
        }

        return Response.json({
          transaction: payload.transaction ?? null,
          requestId: payload.requestId ?? null,
          outAmount: payload.outAmount ?? null,
          lastValidBlockHeight: payload.lastValidBlockHeight ?? null,
        });
      },
    },
  },
});
