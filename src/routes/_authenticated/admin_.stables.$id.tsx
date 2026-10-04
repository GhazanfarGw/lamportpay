import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old admin URL for a payment; the admin app now lives at /admin/payments/$id. */
export const Route = createFileRoute("/_authenticated/admin_/stables/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/admin/payments/$id", params: { id: params.id } });
  },
});
