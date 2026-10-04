import { createFileRoute } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { AppWalletIsland } from "@/components/site/wallet/WalletIsland";
import { supabase } from "@/integrations/supabase/client";
import { requestWalletSignIn, useAppWallet } from "@/lib/wallet-state";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : "/",
  }),
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Sign in — LamportPay" },
      {
        name: "description",
        content: "Sign in to LamportPay with your Solana wallet or email.",
      },
      { property: "og:title", content: "Sign in — LamportPay" },
      {
        property: "og:description",
        content: "Sign in to LamportPay with your Solana wallet or email.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function sanitizeNext(rawNext: string | undefined) {
  const fallback = "/";
  if (!rawNext || !rawNext.startsWith("/") || rawNext.startsWith("//")) return fallback;
  try {
    const parsed = new URL(rawNext, window.location.origin);
    if (parsed.origin !== window.location.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function AuthPage() {
  const { next } = Route.useSearch();
  const safeNext = useMemo(() => sanitizeNext(next), [next]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) window.location.assign(safeNext);
    });
    // Wallet sign-in finishes asynchronously: continue once the session exists.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && event === "SIGNED_IN" && session) window.location.assign(safeNext);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [safeNext]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    if (mode === "reset") {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/reset`,
      });
      setBusy(false);
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setMessage("If an account exists for that email, a password reset link is on its way.");
      return;
    }

    const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });

    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (result.data.session) {
      window.location.assign(safeNext);
      return;
    }

    setError("Sign in did not complete. Please try again.");
  }

  return (
    <main className="min-h-screen bg-background px-5 py-12 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-md items-center">
        <section className="w-full rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-soft)] md:p-8">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">
            LamportPay
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sign in to continue.</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Your account keeps your identity check, your own bank payouts and your history.
          </p>

          <WalletSignInSection />

          <div className="mt-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or with email
            <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="mt-4 space-y-4">
            <label className="block text-sm font-medium">
              Email
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 outline-none transition focus:ring-2 focus:ring-ring"
              />
            </label>
            {mode === "signin" && (
              <label className="block text-sm font-medium">
                Password
                <input
                  required
                  type="password"
                  minLength={6}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 outline-none transition focus:ring-2 focus:ring-ring"
                />
              </label>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {message && (
              <p
                role="status"
                className="rounded-xl border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
              >
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-foreground px-5 py-3 font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Please wait..." : mode === "signin" ? "Sign in" : "Send password reset link"}
            </button>

            <button
              type="button"
              onClick={() => {
                setError(null);
                setMessage(null);
                setMode(mode === "signin" ? "reset" : "signin");
              }}
              className="w-full text-center text-sm font-semibold text-primary hover:underline"
            >
              {mode === "signin" ? "Forgot your password?" : "Back to sign in"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
/**
 * Sign in with wallet: connect (Phantom / Solflare), then sign one message.
 * It is not a transaction; no funds move and no key or seed phrase is asked for.
 */
function WalletSignInSection() {
  const { publicKey, signIn } = useAppWallet();
  const signing = signIn.phase === "signing";
  return (
    <div className="mt-6 space-y-3 rounded-2xl border border-border/60 bg-muted/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Sign in with your wallet</div>
        <AppWalletIsland />
      </div>
      <button
        type="button"
        disabled={signing}
        onClick={() => requestWalletSignIn()}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-[image:var(--gradient-hero)] px-5 py-3 font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Wallet className="h-4 w-4" />
        {signing
          ? "Check your wallet…"
          : publicKey
            ? "Sign message to sign in"
            : "Connect wallet and sign in"}
      </button>
      <p className="text-xs leading-5 text-muted-foreground">
        You sign a short message that proves the wallet is yours. It is not a transaction: no funds
        move and there is no fee. Never share your seed phrase.
      </p>
      {signIn.phase === "error" && signIn.error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {signIn.error}
        </p>
      )}
    </div>
  );
}
