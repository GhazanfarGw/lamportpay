/**
 * The LamportPay app (dApp) shell: a focused header with the wallet and the
 * account, and no marketing navigation or footer. Used by the conversion flow
 * (/pay, which includes any swap) and payment history, so the financial app reads as a
 * product of its own, reached from the marketing site's "Convert" button.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, History, LogOut, Send, UserRound, Wallet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ModeBadge } from "@/components/app/ModeBadge";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
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
/** Sign out of the LamportPay account and return to the converter. */
function useSignOut(after?: () => void) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
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
      after?.();
    }
  };
  return { busy, signOut };
}

function Account() {
  const account = useAccount();
  const { publicKey } = useAppWallet();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { busy, signOut } = useSignOut(() => setOpen(false));
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
              onClick={() => void signOut()}
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

/**
 * Phones: the account lives in the bottom tab bar and opens as a sheet (wallet,
 * history, sign in / out), so the header keeps just the logo, mode and wallet.
 */
function AccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const account = useAccount();
  const { publicKey, signIn } = useAppWallet();
  const queryClient = useQueryClient();
  const close = () => onOpenChange(false);
  const { busy, signOut } = useSignOut(close);
  const signedIn = account.status === "signed_in";
  const differentWallet =
    signedIn && walletLinkOf(publicKey, account.wallets) === "different_wallet";
  const next =
    typeof window === "undefined" ? "/pay" : `${window.location.pathname}${window.location.search}`;
  const row =
    "flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-sm font-medium hover:bg-secondary active:bg-secondary transition-colors [-webkit-tap-highlight-color:transparent]";
  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent
        aria-describedby={undefined}
        className="rounded-t-[28px] border-border/60 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
      >
        <DrawerTitle className="px-6 pt-3 text-base font-semibold">Account</DrawerTitle>
        <div className="px-3 pt-3 space-y-1">
          <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 px-4 py-3.5">
            <span className="grid place-items-center w-9 h-9 rounded-full bg-[image:var(--gradient-hero)] text-white">
              <Wallet className="w-4 h-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-muted-foreground">Wallet</span>
              <span className={`block text-sm font-semibold ${publicKey ? "font-mono" : ""}`}>
                {publicKey ? `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}` : "Not connected"}
              </span>
            </span>
            <span className="ml-auto text-xs font-medium text-muted-foreground">
              {signedIn ? "Signed in" : "Signed out"}
            </span>
          </div>
          {signedIn ? (
            <>
              {differentWallet && (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    void switchToConnectedWallet(() => queryClient.clear());
                  }}
                  className={`${row} text-destructive`}
                >
                  <Wallet className="w-4 h-4" /> Use the connected wallet
                  <ChevronRight className="ml-auto w-4 h-4" />
                </button>
              )}
              <Link to="/payments" onClick={close} className={row}>
                <History className="w-4 h-4 text-muted-foreground" /> My conversions
                <ChevronRight className="ml-auto w-4 h-4 text-muted-foreground" />
              </Link>
              <button
                type="button"
                disabled={busy}
                onClick={() => void signOut()}
                className={`${row} text-destructive disabled:opacity-50`}
              >
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </>
          ) : (
            <div className="space-y-2 px-1 pt-2">
              <button
                type="button"
                disabled={signIn.phase === "signing"}
                onClick={() => {
                  close();
                  requestWalletSignIn({ openPicker: !publicKey });
                }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[image:var(--gradient-hero)] py-3.5 text-base font-semibold text-white shadow-[var(--shadow-soft)] disabled:opacity-60"
              >
                <Wallet className="w-4 h-4" />
                {signIn.phase === "signing" ? "Check your wallet…" : "Sign in with wallet"}
              </button>
              <Link
                to="/auth"
                search={{ next }}
                onClick={close}
                className="block py-2 text-center text-sm font-medium text-primary"
              >
                Use email instead
              </Link>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const account = useAccount();
  const { publicKey } = useAppWallet();
  const accountAlert =
    account.status === "signed_in" &&
    walletLinkOf(publicKey, account.wallets) === "different_wallet";
  // overflow-x-clip, not -hidden: "hidden" makes this div a scroll container,
  // which silently breaks the sticky header and the sticky /pay side panels.
  return (
    <div className="relative isolate min-h-screen flex flex-col bg-background text-foreground overflow-x-clip">
      {/* Brand backdrop: soft violet/cyan glows, concentric brand rings in two
          corners (gradient hairlines, like a bank's hero) and a faint grid. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_15%_-10%,oklch(0.62_0.28_295/0.14),transparent_60%),radial-gradient(ellipse_70%_50%_at_95%_0%,oklch(0.82_0.18_200/0.14),transparent_60%),radial-gradient(ellipse_60%_50%_at_50%_110%,oklch(0.7_0.28_330/0.08),transparent_60%)]" />
        <div className="absolute inset-0 bg-grid-uv opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent_60%)]" />
        {[
          "right-[-260px] top-[-300px] h-[760px] w-[760px] opacity-70",
          "right-[-150px] top-[-190px] h-[540px] w-[540px] opacity-60",
          "right-[-40px] top-[-80px] h-[320px] w-[320px] opacity-50",
          "left-[-300px] bottom-[-340px] h-[820px] w-[820px] opacity-50",
          "left-[-170px] bottom-[-210px] h-[560px] w-[560px] opacity-40",
        ].map((place) => (
          <div
            key={place}
            className={`brand-ring absolute rounded-full max-sm:scale-50 ${place}`}
          />
        ))}
        <div className="absolute right-[12%] top-[18%] h-64 w-64 rounded-full bg-[radial-gradient(circle,oklch(0.82_0.18_200/0.18),transparent_70%)] blur-2xl" />
        <div className="absolute left-[8%] bottom-[10%] h-72 w-72 rounded-full bg-[radial-gradient(circle,oklch(0.62_0.28_295/0.14),transparent_70%)] blur-2xl" />
      </div>

      <header className="sticky top-0 z-40 bg-background/75 backdrop-blur-xl print:hidden">
        <div className="max-w-[1440px] mx-auto px-4 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-3">
          <div className="flex shrink-0 items-center gap-6">
            <Link to="/" aria-label="LamportPay home" className="shrink-0">
              <BrandLogo className="h-[22px] sm:h-8 sm:scale-90 origin-left" />
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
          <div className="flex min-w-0 items-center gap-2">
            <ModeBadge />
            <span className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3 py-1.5 text-xs text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--neon-lime)] shadow-[0_0_8px_var(--neon-lime)]" />
              Solana
            </span>
            <AppWalletIsland />
            {/* Phones: the account is a tab in the bottom bar. */}
            <div className="hidden sm:flex">
              <Account />
            </div>
            <WalletSignInFeedback />
          </div>
        </div>
        <div className="h-px bg-[image:var(--gradient-uv)] opacity-40" />
      </header>
      {/* Phones: the content clears the fixed bottom tab bar (and the home indicator). */}
      <main className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">{children}</main>
      {/* Phones: an app-style bottom tab bar, in thumb reach. */}
      <nav
        className="sm:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] print:hidden"
        aria-label="App"
      >
        <div className="flex h-16">
          {APP_NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="group flex-1 flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground [-webkit-tap-highlight-color:transparent] active:scale-95 transition-transform"
            >
              <span className="grid place-items-center h-7 w-12 rounded-full transition-colors group-data-[status=active]:bg-primary/12 group-data-[status=active]:text-primary">
                <Icon className="w-[18px] h-[18px]" />
              </span>
              <span className="group-data-[status=active]:text-primary group-data-[status=active]:font-semibold">
                {label}
              </span>
            </Link>
          ))}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen(true)}
            data-open={accountOpen || undefined}
            className="group flex-1 flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground [-webkit-tap-highlight-color:transparent] active:scale-95 transition-transform"
          >
            <span className="relative grid place-items-center h-7 w-12 rounded-full transition-colors group-data-[open]:bg-primary/12 group-data-[open]:text-primary">
              <UserRound className="w-[18px] h-[18px]" />
              {accountAlert && (
                <span className="absolute right-2.5 top-0.5 w-2 h-2 rounded-full bg-destructive ring-2 ring-background" />
              )}
            </span>
            <span className="group-data-[open]:text-primary group-data-[open]:font-semibold">
              Account
            </span>
          </button>
        </div>
      </nav>
      <AccountSheet open={accountOpen} onOpenChange={setAccountOpen} />
    </div>
  );
}
