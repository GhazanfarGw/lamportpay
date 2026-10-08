import { createFileRoute } from "@tanstack/react-router";

import { recordModeObserved } from "@/lib/app-mode-log.server";
import { currentMode, publicModeStatus } from "@/lib/app-mode.server";
import { getBusinessSettings } from "@/lib/business-settings.server";
import { getPaymentLimits } from "@/lib/payments/limits.server";
import { configuredPayoutCountries } from "@/lib/payout-countries";
import { getStablesConfig, getStablesWebhookSecret } from "@/lib/stables/config.server";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "@/lib/tokens";

function paymentLimits(currency: PaymentCurrency): { min: string; max: string | null } | null {
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
        // The mode is the server's: this is what the header indicator shows.
        const modeStatus = currentMode();
        void recordModeObserved(modeStatus);
        const stables = getStablesConfig();
        const jupiterConfigured = Boolean(process.env["JUPITER_API_KEY"]);
        const stablesConfigured = stables.configured;
        const stablesLive = stables.configured && stables.environment === "production";

        const jupiterMode = jupiterConfigured ? "sandbox" : "mock";
        const stablesMode = !stables.configured ? "mock" : stablesLive ? "live" : "sandbox";
        // Public business settings only (coins turned on, fee rate); never the revenue wallet.
        const settings = await getBusinessSettings().catch((e: unknown) => {
          console.error("[status] business settings:", e instanceof Error ? e.message : e);
          return null;
        });
        const coins = settings?.enabledCurrencies ?? [...PAYMENT_CURRENCIES];

        return Response.json(
          {
            mode: publicModeStatus(modeStatus),
            providers: [
              {
                name: "Jupiter",
                role: "SOL → USDC swap routing",
                configured: jupiterConfigured,
                mode: jupiterMode,
                note: jupiterConfigured
                  ? "Route previews and orders use live Jupiter data."
                  : "Swaps are not configured: route previews and orders are unavailable.",
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
              paymentLimitsUsdc: settings?.paymentLimits.usdc ?? paymentLimits("usdc"),
              paymentLimits: Object.fromEntries(
                coins.map((currency) => [
                  currency,
                  settings?.paymentLimits[currency] ?? paymentLimits(currency),
                ]),
              ),
              paymentCurrencies: coins,
              platformFeeBps: settings?.conversionFeeBps ?? null,
              platformFeeMin: settings?.feeMin ?? null,
              // Countries the /pay picker offers (PAYOUT_COUNTRIES, or the documented
              // default: TEST MODE only offers what the partner's sandbox completes).
              payoutCountries: configuredPayoutCountries(
                process.env["PAYOUT_COUNTRIES"],
                currentMode().mode,
              ),
              platformFeeMax: settings?.feeMax ?? null,
              outputDestination: "connected wallet only",
            },
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
