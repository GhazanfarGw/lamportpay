import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, MailPlus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AdminSignOutButton } from "@/components/site/AdminSignOutButton";
import { SiteLayout } from "@/components/site/Layout";
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
import {
  cancelAdminInvite,
  getRoleManagement,
  grantRoleByEmail,
  revokeRole,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin_/roles")({
  head: () => ({
    meta: [
      { title: "Admin role management | LamportPay" },
      {
        name: "description",
        content:
          "Internal LamportPay demo page to invite demo users or assign the admin and reviewer roles securely.",
      },
      { property: "og:title", content: "Admin role management | LamportPay" },
      {
        property: "og:description",
        content:
          "Invite demo users or assign admin and reviewer roles for the LamportPay demo operations console.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
    <SiteLayout>
      <div className="mx-auto max-w-3xl px-4 py-12 space-y-8">
        <div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin">
              <ArrowLeft className="w-3.5 h-3.5 mr-2" />
              Back to admin operations
            </Link>
          </Button>
        </div>

        <header className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              Access control
            </div>
            <AdminSignOutButton />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Admin role management</h1>
          <p className="text-sm text-muted-foreground">
            Assign the admin or reviewer role to other demo users. Roles are stored server-side and
            every change is written to the audit log. Existing accounts are updated immediately;
            unknown email addresses are stored as a pending invite that is redeemed on first sign-in.
          </p>
        </header>

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
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={revokeMutation.isPending}
                        onClick={() =>
                          revokeMutation.mutate({
                            userId: row.user_id,
                            role: row.role as AssignableRole,
                          })
                        }
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
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
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate({ id: invite.id })}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </SiteLayout>
  );
}
