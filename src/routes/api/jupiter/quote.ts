import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { SOL_MINT, USDC_MINT, isSupportedInputMint } from "@/lib/tokens";
import {
  MOCK_SOL_USD,
  baseUnitsToUsdc,
  buildMockRoutePreview,
  lamportsToSol,
  type RouteStepPreview,
  type SwapRoutePreview,
} from "@/lib/swap-route";

// Read-only route preview. No taker, no transaction, no signing.
// Same safety limits as the real order endpoint.
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

const SYMBOLS: Record<string, string> = { [SOL_MINT]: "SOL", [USDC_MINT]: "USDC" };
const symbolFor = (mint?: string) => (mint && SYMBOLS[mint]) || `${mint?.slice(0, 4) ?? "?"}…`;

type JupRoutePlan = {
  percent?: number;
  swapInfo?: {
    ammKey?: string;
    label?: string;
    inputMint?: string;
    outputMint?: string;
    feeAmount?: string;
    feeMint?: string;
  };
};

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const Route = createFileRoute("/api/jupiter/quote")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
        if (!apiKey) {
          return Response.json(buildMockRoutePreview(amount));
        }

        const url = new URL("https://api.jup.ag/swap/v2/order");
        url.searchParams.set("inputMint", SOL_MINT);
        url.searchParams.set("outputMint", USDC_MINT);
        url.searchParams.set("amount", amount);

        let upstream: Response;
        try {
          upstream = await fetch(url, {
            headers: { "x-api-key": apiKey, Accept: "application/json" },
          });
        } catch {
          return Response.json(
            buildMockRoutePreview(amount, "Could not reach Jupiter — showing mock routing."),
          );
        }

        let payload: {
          outAmount?: string;
          otherAmountThreshold?: string;
          slippageBps?: number;
          priceImpactPct?: string | number;
          routePlan?: JupRoutePlan[];
          error?: string;
        };
        try {
          payload = (await upstream.json()) as typeof payload;
        } catch {
          return Response.json(
            buildMockRoutePreview(amount, "Invalid Jupiter response — showing mock routing."),
          );
        }

        if (!upstream.ok || !payload.outAmount) {
          return Response.json(
            buildMockRoutePreview(
              amount,
              `Jupiter route unavailable (${upstream.status}) — showing mock routing.`,
            ),
          );
        }

        const inAmountSol = lamportsToSol(amount);
        const outAmountUsdc = baseUnitsToUsdc(payload.outAmount);
        // Read-only order previews come back with slippageBps 0; keep the demo's
        // default tolerance so the min-received figure stays meaningful.
        const slippageBps = payload.slippageBps && payload.slippageBps > 0 ? payload.slippageBps : 50;
        const thresholdUsdc = payload.otherAmountThreshold
          ? baseUnitsToUsdc(payload.otherAmountThreshold)
          : null;
        const minOutAmountUsdc =
          thresholdUsdc !== null && thresholdUsdc < outAmountUsdc
            ? thresholdUsdc
            : outAmountUsdc * (1 - slippageBps / 10_000);

        const steps: RouteStepPreview[] = (payload.routePlan ?? []).map((leg) => {
          const info = leg.swapInfo ?? {};
          const feeMint = info.feeMint;
          const feeAmount = info.feeAmount ? Number(info.feeAmount) : null;
          let feeUsd: number | null = null;
          if (feeAmount !== null) {
            if (feeMint === USDC_MINT) feeUsd = baseUnitsToUsdc(feeAmount);
            else if (feeMint === SOL_MINT) feeUsd = lamportsToSol(feeAmount) * MOCK_SOL_USD;
          }
          return {
            label: `${symbolFor(info.inputMint)} → ${symbolFor(info.outputMint)}`,
            amm: info.label || info.ammKey?.slice(0, 8) || "Unknown AMM",
            inputSymbol: symbolFor(info.inputMint),
            outputSymbol: symbolFor(info.outputMint),
            percent: leg.percent ?? 100,
            feeUsd,
          };
        });

        const lpFeeUsd = steps.reduce((sum, s) => sum + (s.feeUsd ?? 0), 0);

        const preview: SwapRoutePreview = {
          source: "sandbox",
          demoMode: false,
          message: "Live Jupiter routing data (read-only preview — nothing is signed or sent).",
          inputMint: SOL_MINT,
          outputMint: USDC_MINT,
          inAmountLamports: amount,
          inAmountSol,
          outAmountUsdc,
          minOutAmountUsdc,
          slippageBps,
          priceImpactPct:
            payload.priceImpactPct !== undefined ? Number(payload.priceImpactPct) * 100 : null,
          networkFeeSol: 0.000005,
          platformFeeUsd: 0,
          lpFeeUsd,
          steps: steps.length > 0 ? steps : buildMockRoutePreview(amount).steps,
        };

        return Response.json(preview);
      },
    },
  },
});
