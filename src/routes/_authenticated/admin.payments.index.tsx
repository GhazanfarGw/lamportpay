import { createFileRoute } from "@tanstack/react-router";

import { AdminPage } from "@/components/admin/AdminShell";
import { PaymentReportsAdmin } from "@/components/admin/PaymentReportsAdmin";
import { StablesPaymentsAdmin } from "@/components/site/StablesPaymentsAdmin";

export const Route = createFileRoute("/_authenticated/admin/payments/")({
  head: () => ({ meta: [{ title: "Payments | LamportPay Admin" }] }),
  component: () => (
    <AdminPage
      title="Payments"
      crumbs={[{ label: "Payments" }]}
      description="Real payments from the database, newest first. Status follows Stables' own transfer states. Travel Rule wallet-verification holds are listed first."
    >
      <div className="space-y-6">
        <PaymentReportsAdmin />
        <StablesPaymentsAdmin />
      </div>
    </AdminPage>
  ),
});
