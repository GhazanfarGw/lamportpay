import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { handlePublicRequest, json } from "@/lib/payments/http.server";
import { getWalletHoldingsView } from "@/lib/payments/wallet-holdings.server";

const HoldingsInput = z
  .object({
    /** Public key of the connected wallet (connecting is not signing). */
    wallet: z
      .string()
      .trim()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "wallet must be a Solana address."),
  })
  .strict();

/**
 * POST /api/wallet/holdings — the connected wallet's real balances and the
 * most that can be converted after LamportPay's fee. Public (works signed out), rate limited per
 * user / IP; read only. POST keeps the address out of URLs and logs.
 */
export const Route = createFileRoute("/api/wallet/holdings")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handlePublicRequest(request, HoldingsInput, "holdings", 20, async (_user, body) =>
          json(await getWalletHoldingsView(body.wallet)),
        ),
    },
  },
});
