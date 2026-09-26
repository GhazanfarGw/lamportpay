import { Component, lazy, Suspense, useState, type ReactElement, type ReactNode } from "react";
import { ClientOnly } from "@tanstack/react-router";

import type { FundingPanelProps } from "./FundingPanel";
import type { SwapExecution } from "./SwapPanel";

type WalletModule = {
  SolanaWalletProvider: ({ children }: { children: ReactNode }) => ReactElement;
  WalletConnectButton: () => ReactElement;
  WalletStatusCard: () => ReactElement;
};

function ProviderPassthrough({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function WalletFallbackButton() {
  return (
    <button
      type="button"
      disabled
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground opacity-70"
    >
      Connect wallet
    </button>
  );
}

function WalletStartButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full bg-[image:var(--gradient-hero)] text-white px-4 py-2 text-sm font-semibold shadow-[var(--shadow-soft)] hover:opacity-95 transition"
    >
      Connect wallet
    </button>
  );
}

function WalletFallbackCard() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-3">
      <div className="text-sm font-semibold">Wallet connection</div>
      <p className="text-sm text-muted-foreground">
        Wallet connection initializes only in your browser. Refresh if Phantom or Solflare does not
        appear.
      </p>
    </div>
  );
}

class WalletErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Wallet UI failed to load", error);
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

async function loadWalletModule(): Promise<WalletModule> {
  if (typeof window === "undefined") {
    return {
      SolanaWalletProvider: ProviderPassthrough,
      WalletConnectButton: WalletFallbackButton,
      WalletStatusCard: WalletFallbackCard,
    };
  }
  const polyfill = await import("@/lib/buffer-polyfill");
  polyfill.installBufferPolyfill();
  return import("./SolanaWallet");
}

const Providers = lazy(async () => {
  const m = await loadWalletModule();
  return { default: m.SolanaWalletProvider };
});
const ConnectButton = lazy(async () => {
  if (typeof window === "undefined") return { default: WalletFallbackButton };
  const m = await loadWalletModule();
  return { default: m.WalletConnectButton };
});
const StatusCard = lazy(async () => {
  if (typeof window === "undefined") return { default: WalletFallbackCard };
  const m = await loadWalletModule();
  return { default: m.WalletStatusCard };
});
const Swap = lazy(async () => {
  if (typeof window === "undefined") return { default: WalletFallbackCard };
  const polyfill = await import("@/lib/buffer-polyfill");
  polyfill.installBufferPolyfill();
  const m = await import("./SwapPanel");
  return { default: m.SwapPanel };
});
const Funding = lazy(async () => {
  if (typeof window === "undefined") return { default: WalletFallbackCard };
  const polyfill = await import("@/lib/buffer-polyfill");
  polyfill.installBufferPolyfill();
  const m = await import("./FundingPanel");
  return { default: m.FundingPanel };
});

function Island({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  return (
    <ClientOnly fallback={fallback}>
      <WalletErrorBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <Providers>{children}</Providers>
        </Suspense>
      </WalletErrorBoundary>
    </ClientOnly>
  );
}

/** Header connect button (self-contained wallet context). */
export function WalletButtonIsland() {
  return (
    <ClientOnly fallback={<WalletFallbackButton />}>
      <WalletButtonClient />
    </ClientOnly>
  );
}

function WalletButtonClient() {
  const [active, setActive] = useState(false);

  if (!active) return <WalletStartButton onClick={() => setActive(true)} />;

  return (
    <WalletErrorBoundary fallback={<WalletFallbackButton />}>
      <Suspense fallback={<WalletFallbackButton />}>
        <Providers>
          <ConnectButton />
        </Providers>
      </Suspense>
    </WalletErrorBoundary>
  );
}

/** Full wallet panel: connect, address, safety warning. */
export function WalletPanelIsland() {
  return (
    <Island fallback={<WalletFallbackCard />}>
      <StatusCard />
    </Island>
  );
}

/** SOL → USDC Jupiter swap demo panel. */
export function SwapPanelIsland({
  onExecuted,
}: {
  onExecuted?: (execution: SwapExecution) => void;
}) {
  return (
    <Island fallback={<WalletFallbackCard />}>
      <Swap onExecuted={onExecuted} />
    </Island>
  );
}

/** Sends a payment's USDC deposit from the connected wallet. */
export function FundingPanelIsland(props: FundingPanelProps) {
  return (
    <Island fallback={<WalletFallbackCard />}>
      <Funding {...props} />
    </Island>
  );
}
