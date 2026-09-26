import "@/lib/buffer-polyfill";
import { useMemo, useCallback, useEffect, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { clusterApiUrl } from "@solana/web3.js";
import { ShieldAlert, Copy, Check, Wallet, LogOut, ChevronDown } from "lucide-react";

/**
 * Solana wallet context. Mainnet-beta, since Jupiter swap routing only
 * exists on mainnet.
 */
export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => clusterApiUrl(WalletAdapterNetwork.Mainnet), []);
  const wallets = useMemo(() => {
    if (typeof window === "undefined") return [];
    return [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function shortAddress(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export const SEED_PHRASE_WARNING = "Never share your seed phrase or private key.";

/** Compact connect button + wallet picker for the site header. */
export function WalletConnectButton() {
  const { wallets, wallet, select, connect, disconnect, connecting, connected, publicKey } =
    useWallet();
  const [open, setOpen] = useState(false);
  const [pendingWalletName, setPendingWalletName] = useState<string | null>(null);
  const address = publicKey?.toBase58() ?? "";

  useEffect(() => {
    if (!pendingWalletName || connecting || connected) return;
    if (wallet?.adapter.name !== pendingWalletName) return;

    let cancelled = false;
    void connect()
      .catch(() => {
        /* user rejected or wallet not installed */
      })
      .finally(() => {
        if (!cancelled) setPendingWalletName(null);
      });

    return () => {
      cancelled = true;
    };
  }, [pendingWalletName, wallet, connecting, connected, connect]);

  const pick = useCallback(
    (name: (typeof wallets)[number]["adapter"]["name"]) => {
      setOpen(false);
      setPendingWalletName(name);
      select(name);
    },
    [select],
  );

  if (connected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-secondary transition"
      >
        <span className="w-2 h-2 rounded-full bg-[color:var(--success)]" />
        <span className="font-mono">{shortAddress(address)}</span>
        <LogOut className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={connecting}
        className="inline-flex items-center gap-2 rounded-full bg-[image:var(--gradient-hero)] text-white px-4 py-2 text-sm font-semibold shadow-[var(--shadow-soft)] hover:opacity-95 transition disabled:opacity-60"
      >
        <Wallet className="w-4 h-4" />
        {connecting ? "Connecting…" : "Connect wallet"}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-border bg-card p-1.5 shadow-[var(--shadow-soft)]">
          {wallets.map((w) => (
            <button
              key={w.adapter.name}
              onClick={() => pick(w.adapter.name)}
              className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium hover:bg-secondary transition text-left"
            >
              <img src={w.adapter.icon} alt="" className="w-5 h-5 rounded" />
              <span className="flex-1">{w.adapter.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {w.readyState === "Installed" ? "Detected" : "Install"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Connected address + seed-phrase safety warning. */
export function WalletStatusCard() {
  const { publicKey, connected, wallet } = useWallet();
  const [copied, setCopied] = useState(false);
  const address = publicKey?.toBase58() ?? "";

  const copy = useCallback(() => {
    if (!address) return;
    if (typeof navigator !== "undefined") void navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [address]);

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Solana wallet
          </div>
          <div className="font-semibold mt-0.5">
            {connected && address ? (
              <span className="font-mono text-sm">{shortAddress(address)}</span>
            ) : (
              <span className="text-muted-foreground text-sm">Not connected</span>
            )}
          </div>
          {connected && wallet && (
            <div className="text-xs text-muted-foreground mt-1">via {wallet.adapter.name}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {connected && address && (
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-secondary transition"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          <WalletConnectButton />
        </div>
      </div>

      {connected && address && (
        <div className="rounded-xl bg-secondary/60 px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Connected address
          </div>
          <div className="font-mono text-xs break-all mt-0.5">{address}</div>
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-xl border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 px-4 py-3">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-[color:var(--warning)]" />
        <p className="text-xs leading-relaxed">
          <strong>{SEED_PHRASE_WARNING}</strong> Creating an order does not move funds. A real
          Jupiter swap only happens after you review and sign the transaction in your wallet.
        </p>
      </div>
    </div>
  );
}

export default SolanaWalletProvider;
