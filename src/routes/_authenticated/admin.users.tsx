import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { MailPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AdminPage, ConfirmButton } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ASSIGNABLE_ROLES, type AssignableRole } from "@/lib/admin.constants";
import { getCustomerIdentities } from "@/lib/admin-ops.functions";
import { KYC_STATE_LABEL } from "@/lib/identity/kyc-state";
import {
  cancelAdminInvite,
  getRoleManagement,
  grantRoleByEmail,
  revokeRole,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({
    meta: [
      { title: "Users & roles | LamportPay Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RolesPage,
});

function RolesPage() {
  const queryClient = useQueryClient();
  const fetchRoles = useServerFn(getRoleManagement);
  const grant = useServerFn(grantRoleByEmail);
  const revoke = useServerFn(revokeRole);
  const cancelInvite = useServerFn(cancelAdminInvite);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("admin");

  const query = useQuery({ queryKey: ["admin-roles"], queryFn: () => fetchRoles() });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin-roles"] });

  const grantMutation = useMutation({
    mutationFn: (input: { email: string; role: AssignableRole }) => grant({ data: input }),
    onSuccess: (result) => {
      toast.success(
        result.granted
          ? `Role assigned to ${result.email}`
          : `Invite created for ${result.email} — the role is granted the first time they sign in and redeem it.`,
      );
      setEmail("");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (input: { userId: string; role: AssignableRole }) => revoke({ data: input }),
    onSuccess: () => {
      toast.success("Role revoked");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (input: { id: string }) => cancelInvite({ data: input }),
    onSuccess: () => {
      toast.success("Invite cancelled");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = query.data;

  return (
    <AdminPage
      title="Users & roles"
      crumbs={[{ label: "Users & roles" }]}
      description="Give the admin or reviewer role to an account. Roles are stored server-side and every change is written to the audit log. An address with no account yet gets a pending invite, redeemed on first sign-in."
    >
      <div className="max-w-3xl space-y-8">
        {query.isLoading && (
          <div className="rounded-2xl border border-border/60 bg-card p-6 text-sm text-muted-foreground">
            Loading roles…
          </div>
        )}

        {query.isError && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm">
            {(query.error as Error).message}
          </div>
        )}

        {data && !data.isAdmin && (
          <div className="rounded-2xl border border-border/60 bg-card p-6 text-sm text-muted-foreground">
            Your account does not have the admin role, so role management is unavailable.
          </div>
        )}

        {data?.isAdmin && (
          <>
            <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-3">
              <h2 className="font-semibold text-sm">Invite or assign</h2>
              <div className="grid sm:grid-cols-[1fr_150px_auto] gap-2">
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="demo.user@example.com"
                  maxLength={200}
                />
                <Select value={role} onValueChange={(value) => setRole(value as AssignableRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item === "admin" ? "Admin" : "Reviewer"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={grantMutation.isPending || !email.trim()}
                  onClick={() => grantMutation.mutate({ email: email.trim(), role })}
                >
                  <MailPlus className="w-3.5 h-3.5 mr-2" />
                  Assign
                </Button>
              </div>
            </section>

            <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-3">
              <h2 className="font-semibold text-sm">Current roles</h2>
              {data.roles.length === 0 && (
                <p className="text-sm text-muted-foreground">No roles assigned yet.</p>
              )}
              <ul className="divide-y divide-border/50">
                {data.roles.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{row.email ?? "Unknown account"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{row.user_id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                        {row.role}
                      </span>
                      <ConfirmButton
                        variant="ghost"
                        aria-label={`Revoke ${row.role} from ${row.email ?? row.user_id}`}
                        title={`Revoke the ${row.role} role?`}
                        description={`${row.email ?? row.user_id} loses ${row.role} access immediately. This is written to the audit log.`}
                        confirmLabel="Revoke role"
                        disabled={revokeMutation.isPending}
                        onConfirm={() =>
                          revokeMutation.mutate({
                            userId: row.user_id,
                            role: row.role as AssignableRole,
                          })
                        }
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </ConfirmButton>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-3">
              <h2 className="font-semibold text-sm">Pending invites</h2>
              {data.invites.length === 0 && (
                <p className="text-sm text-muted-foreground">No invites.</p>
              )}
              <ul className="divide-y divide-border/50">
                {data.invites.map((invite) => (
                  <li key={invite.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{invite.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {invite.role} · {invite.status}
                        {invite.accepted_at
                          ? ` · ${new Date(invite.accepted_at).toLocaleString()}`
                          : ""}
                      </div>
                    </div>
                    <ConfirmButton
                      variant="ghost"
                      aria-label={`Cancel invite for ${invite.email}`}
                      title="Cancel this invite?"
                      description={`${invite.email} will no longer get the ${invite.role} role on sign-in.`}
                      confirmLabel="Cancel invite"
                      disabled={cancelMutation.isPending}
                      onConfirm={() => cancelMutation.mutate({ id: invite.id })}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </ConfirmButton>
                  </li>
                ))}
              </ul>
            </section>

            <CustomerIdentities />
          </>
        )}
      </div>
    </AdminPage>
  );
}

const KYC_TONE: Record<string, string> = {
  kyc_verified: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  kyc_rejected: "border-destructive/30 bg-destructive/10 text-destructive",
  kyc_action_required: "border-amber-500/30 bg-amber-500/10 text-amber-700",
};

function short(value: string) {
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

/**
 * Wallet ↔ customer ↔ Stables relationship, read-only. A wallet shows only
 * who signed in; KYC comes from Stables' stored answers.
 */
function CustomerIdentities() {
  const fetchIdentities = useServerFn(getCustomerIdentities);
  const query = useQuery({
    queryKey: ["admin-customer-identities"],
    queryFn: () => fetchIdentities(),
  });
  const data = query.data;
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-sm">Customer identities</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Wallet sign-ins and Stables verification per customer. A linked wallet is not proof of
          KYC; the KYC column comes only from Stables.
        </p>
      </div>
      {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {query.isError && (
        <p className="text-sm text-destructive">{(query.error as Error).message}</p>
      )}
      {data && data.customers.length === 0 && (
        <p className="text-sm text-muted-foreground">No customers yet.</p>
      )}
      {data && data.customers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b border-border/50">
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">Wallet</th>
                <th className="py-2 pr-3 font-medium">Wallet last signed in</th>
                <th className="py-2 pr-3 font-medium">KYC</th>
                <th className="py-2 pr-3 font-medium">Stables customer</th>
                <th className="py-2 font-medium">Verified at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.customers.map((c) => (
                <tr key={c.userId}>
                  <td className="py-2 pr-3 font-mono" title={c.userId}>
                    {short(c.userId)}
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    {c.wallets.length === 0 ? (
                      <span className="text-muted-foreground">Email account</span>
                    ) : (
                      c.wallets.map((w) => (
                        <div key={w.address} title={w.address}>
                          {short(w.address)}
                        </div>
                      ))
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {c.wallets[0]?.lastAuthenticatedAt
                      ? new Date(c.wallets[0].lastAuthenticatedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full border px-2 py-0.5 font-semibold ${
                        KYC_TONE[c.kycState] ?? "border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      {KYC_STATE_LABEL[c.kycState]}
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-mono" title={c.stablesCustomerId ?? ""}>
                    {c.stablesCustomerId ? short(c.stablesCustomerId) : "—"}
                  </td>
                  <td className="py-2">
                    {c.verifiedAt ? new Date(c.verifiedAt).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.events.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Recent identity events
          </h3>
          <ul className="divide-y divide-border/40 text-xs">
            {data.events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3 py-1.5">
                <span className="text-muted-foreground">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
                <span className="font-semibold">{e.event.replace(/_/g, " ")}</span>
                <span className="font-mono" title={e.userId}>
                  {short(e.userId)}
                </span>
                {e.walletAddress && (
                  <span className="font-mono" title={e.walletAddress}>
                    {short(e.walletAddress)}
                  </span>
                )}
                {e.event === "kyc_status_changed" && (
                  <span className="text-muted-foreground">{e.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
