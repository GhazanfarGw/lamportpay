/**
 * The LamportPay app (dApp) shell: a focused header with the wallet and the
 * account, and no marketing navigation or footer. Used by the conversion flow
 * (/pay, which includes any swap) and payment history, so the financial app reads as a
 * product of its own, reached from the marketing site's "Convert" button.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { History, LogOut, Send, UserRound, Wallet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ModeBadge } from "@/components/app/ModeBadge";
import { BrandLogo } from "@/components/site/Layout";
import { AppWalletIsland } from "@/components/site/wallet/WalletIsland";
import { supabase } from "@/integrations/supabase/client";
import { walletLinkOf } from "@/lib/identity/wallet-identity";
import { useAccount } from "@/lib/use-account";
import { requestWalletSignIn, setWalletSignIn, useAppWallet } from "@/lib/wallet-state";

// Swapping is part of Convert (/pay): a missing USDC amount is swapped inside
// the payment journey, so there is no separate Swap tab.
const APP_NAV = [
  { to: "/pay", label: "Convert", icon: Send },
  { to: "/payments", label: "History", icon: History },
] as const;

/** Whether someone is signed in: null while unknown (first render / loading). */
export function useSignedIn(): boolean | null {
  const account = useAccount();
  return account.status === "loading" ? null : account.status === "signed_in";
}

/**
 * Wallet sign-in progress and errors, reported once for the whole app: an
 * in-app note before the wallet opens, and a short message if it fails.
 */
function WalletSignInFeedback() {
  const { signIn } = useAppWallet();
  useEffect(() => {
    if (signIn.phase === "signing") {
      toast.message("Sign this message to verify ownership of your wallet. No funds will move.", {
        id: "wallet-sign-in",
      });
      return;
    }
    toast.dismiss("wallet-sign-in");
    if (signIn.phase !== "error" || !signIn.error) return;
    toast.error(signIn.error);
    setWalletSignIn({ phase: "idle", error: null });
  }, [signIn.phase, signIn.error]);
  return null;
}

/**
 * Wallet-first sign-in. Signed out with no wallet: nothing extra — "Connect
 * wallet" connects and verifies in one step (email is linked from the wallet
 * picker). Signed out with a wallet already connected (restored connection):
 * one "Verify wallet" button.
 */
function SignedOutControl() {
  const { publicKey, signIn } = useAppWallet();
  if (!publicKey) return null;
  const signing = signIn.phase === "signing";
  return (
    <button
      type="button"
      disabled={signing}
      onClick={() => requestWalletSignIn({ openPicker: false })}
      title="Sign a message to verify this wallet is yours. No funds move."
      className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-full border border-border bg-card/70 hover:bg-muted disabled:opacity-60"
    >
      <Wallet className="w-4 h-4" />
      {signing ? "Check your wallet…" : "Verify wallet"}
    </button>
  );
}

/** Sign out, then sign in with the wallet that is connected now. */
export async function switchToConnectedWallet(clear: () => void) {
  clear();
  await supabase.auth.signOut();
  requestWalletSignIn({ openPicker: false });
}

/**
 * The LamportPay account (needed for identity verification, own-bank payouts
 * and history). Signed out: the sign-in menu (wallet or email). Signed in: a
 * small account menu (History, Sign out) — no email shown in the header.
 */
function Account() {
  const account = useAccount();
  const { publicKey } = useAppWallet();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (account.status === "loading") return null;
  if (account.status === "signed_out") return <SignedOutControl />;
  const differentWallet = walletLinkOf(publicKey, account.wallets) === "different_wallet";
  return (
    <div className="relative flex items-center gap-2">
      {differentWallet && (
        <button
          type="button"
          onClick={() => void switchToConnectedWallet(() => queryClient.clear())}
          title="The connected wallet is not the one you signed in with."
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
        >
          <Wallet className="w-3.5 h-3.5" /> Use this wallet
        </button>
      )}
      <button
        type="button"
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-border bg-card/70 hover:bg-muted"
      >
        <UserRound className="w-4 h-4" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-48 rounded-xl border border-border bg-card p-1.5 shadow-[var(--shadow-elegant)]">
            <Link
              to="/payments"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-secondary"
            >
              <History className="w-4 h-4" /> My conversions
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await queryClient.cancelQueries();
                  queryClient.clear();
                  await supabase.auth.signOut();
                  navigate({ to: "/pay", replace: true });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not sign out.");
                } finally {
                  setBusy(false);
                  setOpen(false);
                }
              }}
              className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  // overflow-x-clip, not -hidden: "hidden" makes this div a scroll container,
  // which silently breaks the sticky header and the sticky /pay side panels.
  return (
    <div className="relative min-h-screen flex flex-col bg-background text-foreground overflow-x-clip">
      {/* Brand backdrop: soft violet/cyan glows and a faint grid, behind everything. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_15%_-10%,oklch(0.62_0.28_295/0.14),transparent_60%),radial-gradient(ellipse_70%_50%_at_95%_0%,oklch(0.82_0.18_200/0.14),transparent_60%),radial-gradient(ellipse_60%_50%_at_50%_110%,oklch(0.7_0.28_330/0.08),transparent_60%)]" />
        <div className="absolute inset-0 bg-grid-uv opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
      </div>

      <header className="sticky top-0 z-40 bg-background/75 backdrop-blur-xl print:hidden">
        <div className="max-w-[1440px] mx-auto px-4 lg:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-6">
            <Link to="/" aria-label="LamportPay home" className="shrink-0">
              <BrandLogo className="scale-90 origin-left" />
            </Link>
            <nav
              className="hidden sm:flex items-center gap-1 rounded-full border border-border/60 bg-card/70 p-1"
              aria-label="App"
            >
              {APP_NAV.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-full text-muted-foreground hover:text-foreground transition-colors"
                  activeProps={{
                    className:
                      "inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-full bg-[image:var(--gradient-hero)] text-white font-medium shadow-[var(--shadow-soft)]",
                  }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <ModeBadge />
            <span className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3 py-1.5 text-xs text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--neon-lime)] shadow-[0_0_8px_var(--neon-lime)]" />
              Solana
            </span>
            <AppWalletIsland />
            <Account />
            <WalletSignInFeedback />
          </div>
        </div>
        <div className="h-px bg-[image:var(--gradient-uv)] opacity-40" />
        {/* Mobile tab bar */}
        <nav className="sm:hidden flex border-b border-border/60 bg-background/80" aria-label="App">
          {APP_NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground"
              activeProps={{
                className:
                  "flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] text-primary font-semibold",
              }}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
