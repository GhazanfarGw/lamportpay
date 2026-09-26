import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/reset")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Choose a new password — LamportPay" },
      {
        name: "description",
        content: "Set a new password for your LamportPay operations account.",
      },
      { property: "og:title", content: "Choose a new password — LamportPay" },
      {
        property: "og:description",
        content: "Complete your LamportPay password reset and regain access to the console.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setReady(Boolean(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
  }

  return (
    <main className="min-h-screen bg-background px-5 py-12 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-md items-center">
        <section className="w-full rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-soft)] md:p-8">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">
            LamportPay account recovery
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Choose a new password.</h1>

          {done ? (
            <div className="mt-6 space-y-4">
              <p role="status" className="rounded-xl border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                Your password has been updated.
              </p>
              <a
                href="/auth"
                className="block w-full rounded-full bg-foreground px-5 py-3 text-center font-semibold text-background transition hover:opacity-90"
              >
                Continue to sign in
              </a>
            </div>
          ) : (
            <>
              {!ready && (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Open this page from the reset link in your email. If the link has expired, request
                  a new one from the sign-in page.
                </p>
              )}
              <form onSubmit={submit} className="mt-6 space-y-4">
                <label className="block text-sm font-medium">
                  New password
                  <input
                    required
                    type="password"
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 outline-none transition focus:ring-2 focus:ring-ring"
                  />
                </label>
                <label className="block text-sm font-medium">
                  Confirm new password
                  <input
                    required
                    type="password"
                    minLength={8}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 outline-none transition focus:ring-2 focus:ring-ring"
                  />
                </label>

                {error && (
                  <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy || !ready}
                  className="w-full rounded-full bg-foreground px-5 py-3 font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Updating..." : "Update password"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
