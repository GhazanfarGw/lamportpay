import { createFileRoute } from "@tanstack/react-router";

import { SiteLayout } from "@/components/site/Layout";
import { SwapPanelIsland } from "@/components/site/wallet/WalletIsland";
import { SwapRoutePreviewCard } from "@/components/site/SwapRoutePreview";
import { IntegrationStatusPanel } from "@/components/site/IntegrationStatusPanel";
import { SolanaRpcVerifier } from "@/components/site/SolanaRpcVerifier";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/swap")({
  head: () =>
    pageSeo({
      path: "/swap",
      title: "SOL to USDC Swap Demo | LamportPay",
      description:
        "Connect Phantom or Solflare and run a small, strictly limited SOL to USDC swap routed through Jupiter. Output returns to your own connected wallet.",
    }),
  component: SwapPage,
});

function SwapPage() {
  return (
    <SiteLayout>
      <section className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">
          Jupiter swap
        </div>
        <h1 className="mt-2 text-5 md:text-5xl font-semibold tracking-tight">
          Swap SOL to USDC.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Sign in, connect Phantom or Solflare, create a Jupiter order, sign it in your wallet, and
          execute the swap. The output stays in your own wallet. To pay out to a bank, use Pay.
        </p>

        <div className="mt-10">
          <SwapPanelIsland />
        </div>

        <div className="mt-10 space-y-6">
          <SwapRoutePreviewCard />
          <SolanaRpcVerifier />
          <IntegrationStatusPanel />
        </div>
      </section>
    </SiteLayout>
  );
}
