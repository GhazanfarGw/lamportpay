import { createFileRoute } from "@tanstack/react-router";

import { getPaymentLimits } from "@/lib/payments/limits.server";
import { getStablesConfig, getStablesWebhookSecret } from "@/lib/stables/config.server";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "@/lib/tokens";

function paymentLimits(currency: PaymentCurrency): { min: string; max: string } | null {
  try {
    const { min, max } = getPaymentLimits(currency);
    return { min, max };
  } catch {
    return null; // Misconfigured; payment creation reports it.
  }
}

/**
 * Read-only integration status. Returns booleans only — never key values,
 * prefixes, or lengths.
 */
export const Route = createFileRoute("/api/integration-status")({
  server: {
    handlers: {
      GET: async () => {
        const stables = getStablesConfig();
        const jupiterConfigured = Boolean(process.env["JUPITER_API_KEY"]);
        const stablesConfigured = stables.configured;
        const stablesLive = stables.configured && stables.environment === "production";

        const jupiterMode = jupiterConfigured ? "sandbox" : "mock";
        const stablesMode = !stables.configured ? "mock" : stablesLive ? "live" : "sandbox";

        return Response.json(
          {
            providers: [
              {
                name: "Jupiter",
                role: "SOL → USDC swap routing",
                configured: jupiterConfigured,
                mode: jupiterMode,
                note: jupiterConfigured
                  ? "Route previews and orders use live Jupiter data."
                  : "Route previews fall back to local mock routing.",
              },
              {
                name: "Stables",
                role: "KYC, USDC/USDT → local currency conversion and payout",
                configured: stablesConfigured,
                mode: stablesMode,
                note: !stables.configured
                  ? "Payments are unavailable until STABLES_API_KEY is set."
                  : stablesLive
                    ? "Production: transfers move real money."
                    : "Sandbox: customers and KYC only; transfers cannot be funded.",
              },
            ],
            endpoints: [
              { path: "POST /api/jupiter/quote", provider: "Jupiter", mode: jupiterMode },
              { path: "POST /api/jupiter/order", provider: "Jupiter", mode: jupiterMode },
              { path: "POST /api/jupiter/execute", provider: "Jupiter", mode: jupiterMode },
              { path: "GET|POST /api/kyc", provider: "Stables", mode: stablesMode },
              { path: "POST /api/payments", provider: "Stables", mode: stablesMode },
              { path: "POST /api/payments/:id/quote", provider: "Stables", mode: stablesMode },
              { path: "POST /api/payments/:id/transfer", provider: "Stables", mode: stablesMode },
              { path: "POST /api/payments/:id/funding", provider: "Solana", mode: stablesMode },
              { path: "POST /api/public/stables-webhook", provider: "Stables", mode: stablesMode },
              {
                path: "GET|POST /api/cron/reconcile-payments",
                provider: "Stables",
                mode: stablesMode,
              },
            ],
            guards: {
              fiatPayoutEnabled: stablesLive,
              kycEnabled: stablesConfigured,
              webhookVerification: Boolean(getStablesWebhookSecret()),
              swapLimits: "0.001 – 0.01 SOL",
              paymentLimitsUsdc: paymentLimits("usdc"),
              paymentLimits: Object.fromEntries(
                PAYMENT_CURRENCIES.map((currency) => [currency, paymentLimits(currency)]),
              ),
              outputDestination: "connected wallet only",
            },
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
