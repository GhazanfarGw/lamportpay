import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

type AuthorizationClient = {
  id?: string;
  name?: string;
  uri?: string;
  logo_uri?: string;
};

type AuthorizationDetails = {
  authorization_id?: string;
  client?: AuthorizationClient;
  redirect_uri?: string;
  scope?: string;
  user?: { email?: string };
  redirect_url?: string;
  redirect_to?: string;
};

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    authorization_id: typeof search.authorization_id === "string" ? search.authorization_id : "",
  }),
  head: () => ({
    meta: [
      { title: "Approve agent connection — LamportPay" },
      {
        name: "description",
        content: "Review and approve a protected LamportPay agent integration connection.",
      },
      { property: "og:title", content: "Approve agent connection — LamportPay" },
      {
        property: "og:description",
        content: "Authorize an agent integration to use LamportPay as your signed-in account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConsentPage,
});

function currentRelativeUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function scopeLabels(scope: string | undefined) {
  const scopes = (scope ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (scopes.length === 0) return ["Use LamportPay's enabled agent tools"];
  return scopes.map((item) => {
    if (item === "openid") return "Verify your signed-in account";
    if (item === "email") return "Share your email address";
    if (item === "profile") return "Share your basic profile";
    return `Additional permission requested: ${item}`;
  });
}

function ConsentPage() {
  const { authorization_id } = Route.useSearch();
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadAuthorization() {
      if (!authorization_id) {
        setError("Missing authorization request.");
        setLoading(false);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        window.location.assign(`/auth?next=${encodeURIComponent(currentRelativeUrl())}`);
        return;
      }

      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorization_id);
      if (!active) return;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      const authorization = data as AuthorizationDetails;
      const immediateRedirect = authorization.redirect_url ?? authorization.redirect_to;
      if (immediateRedirect && !authorization.client) {
        window.location.assign(immediateRedirect);
        return;
      }

      setDetails(authorization);
      setLoading(false);
    }

    loadAuthorization();
    return () => {
      active = false;
    };
  }, [authorization_id]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorization_id, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorization_id, { skipBrowserRedirect: true });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    const target = (data as AuthorizationDetails | null)?.redirect_url ?? (data as AuthorizationDetails | null)?.redirect_to;
    if (!target) {
      setError("No redirect was returned for this authorization request.");
      setBusy(false);
      return;
    }
    window.location.assign(target);
  }

  const clientName = details?.client?.name ?? "this app";
  const scopes = scopeLabels(details?.scope);

  return (
    <main className="min-h-screen bg-background px-5 py-12 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-lg items-center">
        <section className="w-full rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-soft)] md:p-8">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">
            LamportPay agent integration
          </div>
          {loading ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading authorization request...</p>
          ) : error && !details ? (
            <div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight">Connection unavailable.</h1>
              <p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            </div>
          ) : (
            <>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight">
                Connect {clientName} to LamportPay?
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {clientName} will be able to call LamportPay's enabled MCP tools while you are
                signed in. This does not bypass app permissions or backend policies.
              </p>

              <div className="mt-6 space-y-3 rounded-2xl border border-border/60 bg-background p-4 text-sm">
                <div>
                  <div className="font-semibold">Signed-in account</div>
                  <div className="mt-1 text-muted-foreground">{details?.user?.email ?? "Your account"}</div>
                </div>
                {details?.redirect_uri && (
                  <div>
                    <div className="font-semibold">Client redirect</div>
                    <div className="mt-1 break-all text-muted-foreground">{details.redirect_uri}</div>
                  </div>
                )}
              </div>

              <div className="mt-6">
                <div className="text-sm font-semibold">Requested access</div>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {scopes.map((scope) => (
                    <li key={scope} className="rounded-xl bg-muted px-3 py-2">
                      {scope}
                    </li>
                  ))}
                  <li className="rounded-xl bg-muted px-3 py-2">
                    Read LamportPay's public demo product, corridor, fee, and swap configuration data
                  </li>
                </ul>
              </div>

              {error && (
                <p role="alert" className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide(true)}
                  className="flex-1 rounded-full bg-foreground px-5 py-3 font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Working..." : "Approve connection"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide(false)}
                  className="flex-1 rounded-full border border-border bg-background px-5 py-3 font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel connection
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}