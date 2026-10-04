import { createFileRoute } from "@tanstack/react-router";

import { AdminPage } from "@/components/admin/AdminShell";
import { StablesPaymentsAdmin } from "@/components/site/StablesPaymentsAdmin";

export const Route = createFileRoute("/_authenticated/admin/payments/")({
  head: () => ({ meta: [{ title: "Payments | LamportPay Admin" }] }),
  component: () => (
    <AdminPage
      title="Payments"
      crumbs={[{ label: "Payments" }]}
      description="Real payments from the database, newest first. Status follows Stables' own transfer states. Travel Rule wallet-verification holds are listed first."
    >
      <StablesPaymentsAdmin />
    </AdminPage>
  ),
});
