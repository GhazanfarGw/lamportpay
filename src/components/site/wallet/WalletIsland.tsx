import { Component, lazy, Suspense, useState, type ReactElement, type ReactNode } from "react";
import { ClientOnly } from "@tanstack/react-router";

import type { FundingPanelProps } from "./FundingPanel";
import type { TestPayPanelProps } from "./TestPayPanel";
import type { PaymentSwapPanelProps } from "./PaymentWallet";
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

const Key = lazy(async () => {
  if (typeof window === "undefined") return { default: WalletFallbackCard };
  const polyfill = await import("@/lib/buffer-polyfill");
  polyfill.installBufferPolyfill();
  const m = await import("./PaymentWallet");
  return { default: m.WalletKey };
});
const PaymentSwap = lazy(async () => {
  if (typeof window === "undefined") return { default: WalletFallbackCard };
  const polyfill = await import("@/lib/buffer-polyfill");
  polyfill.installBufferPolyfill();
  const m = await import("./PaymentWallet");
  return { default: m.PaymentSwapPanel };
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

const AppControl = lazy(async () => {
  if (typeof window === "undefined") return { default: WalletFallbackButton };
  const polyfill = await import("@/lib/buffer-polyfill");
  polyfill.installBufferPolyfill();
  const m = await import("./AppWallet");
  return { default: m.AppWalletControl };
});

/**
 * The dApp header's wallet control. Unlike the marketing header, it loads the
 * wallet right away (auto-reconnecting a trusted wallet) and shares the
 * connection with the page, so /pay needs no connect UI of its own.
 */
export function AppWalletIsland() {
  return (
    <ClientOnly fallback={<WalletFallbackButton />}>
      <WalletErrorBoundary fallback={<WalletFallbackButton />}>
        <Suspense fallback={<WalletFallbackButton />}>
          <Providers>
            <AppControl />
          </Providers>
        </Suspense>
      </WalletErrorBoundary>
    </ClientOnly>
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

/** Connect card that reports the connected public key (connecting is not signing). */
export function WalletKeyIsland({ onChange }: { onChange: (publicKey: string | null) => void }) {
  return (
    <Island fallback={<WalletFallbackCard />}>
      <Key onChange={onChange} />
    </Island>
  );
}

/** Swap the missing amount into a payment's coin, in the user's own wallet. */
export function PaymentSwapIsland(props: PaymentSwapPanelProps) {
  return (
    <Island fallback={<WalletFallbackCard />}>
      <PaymentSwap {...props} />
    </Island>
  );
}

const TestPay = lazy(async () => {
  if (typeof window === "undefined") return { default: WalletFallbackCard };
  const polyfill = await import("@/lib/buffer-polyfill");
  polyfill.installBufferPolyfill();
  const m = await import("./TestPayPanel");
  return { default: m.TestPayPanel };
});

/** TEST MODE "Pay Now": a real devnet transaction that moves no funds. */
export function TestPayIsland(props: TestPayPanelProps) {
  return (
    <Island fallback={<WalletFallbackCard />}>
      <TestPay {...props} />
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
