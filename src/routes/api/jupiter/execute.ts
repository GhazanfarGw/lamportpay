import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const ExecuteInput = z
  .object({
    signedTransaction: z
      .string()
      .min(1, "signedTransaction is required.")
      .refine((v) => v.length % 4 === 0 && BASE64_RE.test(v), {
        message: "signedTransaction must be a base64 string.",
      }),
    requestId: z.string().min(1, "requestId is required."),
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

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const Route = createFileRoute("/api/jupiter/execute")({
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

        const { signedTransaction, requestId, lastValidBlockHeight } = parsed.data;

        let upstream: Response;
        try {
          upstream = await fetch("https://api.jup.ag/swap/v2/execute", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              signedTransaction,
              requestId,
              ...(lastValidBlockHeight !== undefined ? { lastValidBlockHeight } : {}),
            }),
          });
        } catch {
          return errorResponse("Failed to reach Jupiter API.", 502);
        }

        let payload: {
          status?: string;
          signature?: string;
          totalInputAmount?: string;
          totalOutputAmount?: string;
          inputAmountResult?: string;
          outputAmountResult?: string;
          error?: string;
        };
        try {
          payload = (await upstream.json()) as typeof payload;
        } catch {
          return errorResponse("Invalid response from Jupiter API.", 502);
        }

        if (!upstream.ok || payload.error) {
          return errorResponse(payload.error ?? `Jupiter API error (${upstream.status}).`, 502);
        }

        return Response.json({
          status: payload.status ?? null,
          signature: payload.signature ?? null,
          totalInputAmount: payload.totalInputAmount ?? null,
          totalOutputAmount: payload.totalOutputAmount ?? null,
          inputAmountResult: payload.inputAmountResult ?? null,
          outputAmountResult: payload.outputAmountResult ?? null,
          error: payload.error ?? null,
        });
      },
    },
  },
});
