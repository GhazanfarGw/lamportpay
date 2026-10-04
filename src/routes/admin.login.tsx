import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Lock, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { BrandLogo } from "@/components/site/Layout";
import { supabase } from "@/integrations/supabase/client";
import { getAdminSession } from "@/lib/admin-ops.functions";
import { safeAdminNext } from "@/lib/admin-path";

/**
 * Admin sign-in: its own page, separate from the customer sign-in (/auth).
 * Same Supabase account security; after sign-in the admin role is checked on
 * the server, and a non-admin account is signed straight back out.
 */
export const Route = createFileRoute("/admin/login")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : "/admin",
  }),
  head: () => ({
    meta: [
      { title: "Admin sign in — LamportPay" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminLoginPage,
});

const inputClass =
  "mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white placeholder:text-white/30 outline-none transition focus:border-white/30 focus:ring-2 focus:ring-white/10";

function AdminLoginPage() {
  const { next } = Route.useSearch();
  const target = useMemo(() => safeAdminNext(next, window.location.origin), [next]);
  const checkSession = useServerFn(getAdminSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in as an admin: go straight in.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active || !data.session) return;
      try {
        const session = await checkSession();
        if (active && session.isAdmin) window.location.assign(target);
      } catch {
        /* stay on the sign-in form */
      }
    });
    return () => {
      active = false;
    };
  }, [checkSession, target]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error || !result.data.session) {
      setBusy(false);
      setError("Email or password is incorrect.");
      return;
    }
    try {
      const session = await checkSession();
      if (session.isAdmin) {
        window.location.assign(target);
        return;
      }
      await supabase.auth.signOut();
      setError("This account does not have admin access.");
    } catch {
      await supabase.auth.signOut();
      setError("Could not check admin access. Please try again.");
    }
    setBusy(false);
  }

  return (
    <main className="min-h-screen bg-[#0b0d17] text-white">
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-12">
        <div className="flex items-center gap-3">
          <BrandLogo className="h-7 brightness-0 invert" />
          <span className="rounded-md border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/70">
            Admin
          </span>
        </div>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Operations console
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Admin sign in</h1>
          <p className="mt-2 text-sm leading-6 text-white/60">
            For LamportPay staff only. Every admin action is recorded in the audit log.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-sm font-medium text-white/80">
              Work email
              <input
                required
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-white/80">
              Password
              <input
                required
                type="password"
                minLength={6}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClass}
              />
            </label>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 font-semibold text-[#0b0d17] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Lock className="h-4 w-4" />
              {busy ? "Checking…" : "Sign in to admin"}
            </button>
          </form>
        </section>

        <p className="mt-6 text-center text-xs text-white/40">
          Not staff?{" "}
          <Link to="/pay" className="text-white/70 hover:text-white">
            Go to the LamportPay app
          </Link>
        </p>
      </div>
    </main>
  );
}
