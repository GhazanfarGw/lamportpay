import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { AdminPage, ErrorState, LoadingState, Panel } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { getSystemStatus } from "@/lib/admin-ops.functions";

export const Route = createFileRoute("/_authenticated/admin/system-status")({
  head: () => ({ meta: [{ title: "System status | LamportPay Admin" }] }),
  component: SystemStatusPage,
});

function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: ReactNode }) {
  return (
    <li className="flex items-start gap-2 py-2">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 mt-0.5 text-[color:var(--success)] shrink-0" />
      ) : (
        <CircleAlert className="w-4 h-4 mt-0.5 text-destructive shrink-0" />
      )}
      <div>
        <div className="text-sm">{label}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
    </li>
  );
}

function SystemStatusPage() {
  const fetchStatus = useServerFn(getSystemStatus);
  const query = useQuery({ queryKey: ["admin-system-status"], queryFn: () => fetchStatus() });
  const s = query.data;

  return (
    <AdminPage
      title="System status"
      crumbs={[{ label: "System status" }]}
      description="What this server can see about its own configuration and stored provider activity. It does not ping providers, so it never claims a provider is up."
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-2 ${query.isFetching ? "animate-spin" : ""}`} />
          Check again
        </Button>
      }
    >
      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState error={query.error} />}
      {s && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Panel title="Stables (fiat payout)">
            <ul className="divide-y divide-border/50">
              <Check
                ok={s.stables.configured}
                label={
                  s.stables.configured ? `Configured · ${s.stables.environment}` : "Not configured"
                }
              />
              <Check ok={s.stables.webhookSecretSet} label="Webhook signing secret set" />
              <Check
                ok={Boolean(s.stables.lastWebhook)}
                label="Last webhook received"
                detail={
                  s.stables.lastWebhook
                    ? `${s.stables.lastWebhook.event_type} · ${new Date(s.stables.lastWebhook.received_at).toLocaleString()}`
                    : "None stored yet"
                }
              />
              <Check
                ok={s.stables.unprocessedFailures === 0}
                label="Webhook deliveries waiting for retry"
                detail={
                  s.stables.unprocessedFailures === null
                    ? "Could not read"
                    : String(s.stables.unprocessedFailures)
                }
              />
            </ul>
          </Panel>
          <Panel title="TEST / LIVE mode">
            <ul className="divide-y divide-border/50">
              <Check
                ok={s.mode.ok}
                label={`${s.mode.mode.toUpperCase()} MODE${s.mode.ok ? "" : " · BLOCKED"} · Solana ${s.mode.solanaCluster} · Stables ${s.mode.stablesEnvironment}`}
                detail={
                  s.mode.ok ? "Set by LAMPORTPAY_MODE on the server." : s.mode.problems.join(" ")
                }
              />
              <Check
                ok={s.mode.liveAvailable}
                label={s.mode.liveAvailable ? "LIVE MODE available" : "LIVE MODE not available"}
                detail={s.mode.liveAvailable ? undefined : s.mode.liveBlockers.join(" ")}
              />
            </ul>
          </Panel>
          <Panel title="Jupiter (swaps) and Solana">
            <ul className="divide-y divide-border/50">
              <Check ok={s.jupiter.configured} label="Jupiter API key set" />
              <Check
                ok={true}
                label={
                  s.jupiter.referralAccountSet
                    ? "Jupiter referral account set (dormant: one total fee)"
                    : "No Jupiter referral account (not needed with one total fee)"
                }
              />
              <Check
                ok={s.solana.customRpc}
                label={s.solana.customRpc ? "Dedicated Solana RPC set" : "Public Solana RPC in use"}
                detail={s.solana.customRpc ? undefined : "Set SOLANA_RPC_URL before production."}
              />
            </ul>
          </Panel>
          <Panel title="Business settings">
            <ul className="divide-y divide-border/50">
              {s.settings.ok ? (
                <>
                  <Check ok label={`LamportPay fee: ${s.settings.feeBps / 100}%`} />
                  <Check
                    ok={s.settings.revenueWalletSet || s.settings.feeBps === 0}
                    label={
                      s.settings.revenueWalletSet
                        ? "Revenue wallet set"
                        : "No revenue wallet (fee off)"
                    }
                  />
                  <Check
                    ok
                    label={`Payment coins: ${s.settings.enabledCurrencies.map((c) => c.toUpperCase()).join(", ")}`}
                  />
                </>
              ) : (
                <Check
                  ok={false}
                  label="Settings invalid: payments paused"
                  detail={s.settings.error}
                />
              )}
            </ul>
          </Panel>
          <Panel title="Payment limits (.env)">
            <ul className="divide-y divide-border/50">
              {Object.entries(s.limits).map(([coin, l]) => (
                <Check
                  key={coin}
                  ok={!("error" in l)}
                  label={coin.toUpperCase()}
                  detail={
                    "error" in l
                      ? l.error
                      : `Minimum ${l.min} · Maximum ${l.max ?? "Stables' limits"}`
                  }
                />
              ))}
              <Check ok label={`Payout estimate shown to users: ~${s.payoutEstimateMinutes} min`} />
            </ul>
          </Panel>
        </div>
      )}
      {s && (
        <p className="text-xs text-muted-foreground">
          Checked {new Date(s.checkedAt).toLocaleString()}. Secrets are never shown here.
        </p>
      )}
    </AdminPage>
  );
}
