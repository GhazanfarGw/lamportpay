import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { getAdminSession } from "@/lib/admin-ops.functions";

/**
 * LamportPay Admin: its own application, separate from the marketing site
 * (no site header or footer). Every page under /admin renders inside the
 * admin shell; the admin role is checked here for the UI and again by every
 * server function.
 */
export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [{ title: "LamportPay Admin" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const fetchSession = useServerFn(getAdminSession);
  const session = useQuery({ queryKey: ["admin-session"], queryFn: () => fetchSession() });

  if (session.isLoading) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">
        Loading admin…
      </div>
    );
  }
  if (session.isError || !session.data?.isAdmin) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="max-w-md rounded-xl border border-border/60 bg-background p-6 space-y-3 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="w-4 h-4 text-destructive" />
            {session.isError ? "Could not check admin access" : "Admin role required"}
          </div>
          <p className="text-muted-foreground">
            {session.isError
              ? (session.error as Error).message
              : "This account is signed in but has no admin role. An existing admin can grant it from Users & roles."}
          </p>
          <div className="flex gap-4">
            <Link
              to="/admin/login"
              search={{ next: "/admin" }}
              className="text-primary hover:underline"
            >
              Sign in with an admin account
            </Link>
            <Link to="/" className="text-primary hover:underline">
              Back to the public site
            </Link>
          </div>
        </div>
      </div>
    );
  }
  return (
    <AdminShell email={session.data.email} environment={session.data.stablesEnvironment}>
      <Outlet />
    </AdminShell>
  );
}
