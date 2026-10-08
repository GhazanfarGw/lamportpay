import "@/lib/buffer-polyfill";
import { useMemo, useCallback, useEffect, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { clusterApiUrl } from "@solana/web3.js";
import { clientBuildMode } from "@/lib/app-mode";
import { ShieldAlert, Copy, Check, Wallet, LogOut, ChevronDown, ExternalLink } from "lucide-react";

/**
 * Solana wallet context on the cluster of this app's mode: devnet in TEST
 * MODE (test assets only), mainnet-beta in LIVE MODE. The server enforces the
 * same split; this only decides where the browser's wallet connection points.
 */
export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(
    () =>
      clusterApiUrl(
        clientBuildMode() === "live" ? WalletAdapterNetwork.Mainnet : WalletAdapterNetwork.Devnet,
      ),
    [],
  );
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

/**
 * Compact connect button + wallet picker for the site header. `openRequest`
 * (a counter) opens the picker when a page asks for a wallet. When connected,
 * the button opens a small menu (copy, explorer, disconnect) instead of
 * disconnecting on a single click.
 */
export function WalletConnectButton({
  openRequest = 0,
  onPick,
  pickerFooter,
}: {
  openRequest?: number;
  /** Called when the user picks a wallet in the picker (a user-initiated connect). */
  onPick?: () => void;
  /** Extra content at the bottom of the wallet picker. */
  pickerFooter?: ReactNode;
} = {}) {
  const { wallets, wallet, select, connect, disconnect, connecting, connected, publicKey } =
    useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingWalletName, setPendingWalletName] = useState<string | null>(null);
  const address = publicKey?.toBase58() ?? "";

  useEffect(() => {
    if (openRequest > 0) setOpen(true);
  }, [openRequest]);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

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
      onPick?.();
    },
    [select, onPick],
  );

  if (connected && address) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 sm:gap-2 whitespace-nowrap rounded-full border border-border bg-card pl-1.5 pr-2.5 sm:px-3 py-1.5 text-[13px] sm:text-sm font-semibold hover:bg-secondary transition"
        >
          {wallet?.adapter.icon ? (
            <img src={wallet.adapter.icon} alt="" className="w-5 h-5 rounded" />
          ) : (
            <Wallet className="w-4 h-4" />
          )}
          <span className="font-mono">{shortAddress(address)}</span>
          <span className="w-2 h-2 rounded-full bg-[color:var(--success)]" aria-label="Connected" />
          <ChevronDown className="hidden sm:block w-3.5 h-3.5 text-muted-foreground" />
        </button>
        {open && (
          <>
            <button
              type="button"
              aria-label="Close"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setOpen(false)}
            />
            <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-card p-1.5 shadow-[var(--shadow-elegant)]">
              <div className="px-3 py-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Connected{wallet ? ` · ${wallet.adapter.name}` : ""}
                </div>
                <div className="font-mono text-xs break-all mt-1">{address}</div>
              </div>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-secondary transition text-left"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied" : "Copy address"}
              </button>
              <a
                href={`https://explorer.solana.com/address/${address}${clientBuildMode() === "live" ? "" : "?cluster=devnet"}`}
                target="_blank"
                rel="noreferrer"
                className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-secondary transition"
              >
                <ExternalLink className="w-4 h-4" />
                View on Solana Explorer
              </a>
              <button
                onClick={() => {
                  setOpen(false);
                  void disconnect();
                }}
                className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition text-left"
              >
                <LogOut className="w-4 h-4" />
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={connecting}
        className="inline-flex items-center gap-1.5 sm:gap-2 whitespace-nowrap rounded-full bg-[image:var(--gradient-hero)] text-white px-3 sm:px-4 py-2 text-sm font-semibold shadow-[var(--shadow-soft)] hover:opacity-95 transition disabled:opacity-60"
      >
        <Wallet className="w-4 h-4" />
        {connecting ? (
          "Connecting…"
        ) : (
          <span>
            Connect<span className="hidden sm:inline"> wallet</span>
          </span>
        )}
        <ChevronDown className="hidden sm:block w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-border bg-card p-1.5 shadow-[var(--shadow-elegant)]">
            <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              Choose a Solana wallet
            </div>
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
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              Connecting shares your public address only.
            </p>
            {pickerFooter}
          </div>
        </>
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
