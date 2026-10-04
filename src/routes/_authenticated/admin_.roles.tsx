import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old admin URL for role management; now /admin/users. */
export const Route = createFileRoute("/_authenticated/admin_/roles")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/users" });
  },
});
