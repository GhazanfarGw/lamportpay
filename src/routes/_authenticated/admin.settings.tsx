import { createFileRoute, Link } from "@tanstack/react-router";

import { AdminPage, Panel } from "@/components/admin/AdminShell";
import { PaymentCoinSettings, PaymentLimitSettings } from "@/components/site/BusinessSettingsAdmin";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  head: () => ({ meta: [{ title: "Settings | LamportPay Admin" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <AdminPage
      title="Settings"
      crumbs={[{ label: "Settings" }]}
      description="Business configuration an admin can change. Infrastructure secrets (API keys, webhook secrets, database keys) are never shown or edited here; they live only in the server environment."
    >
      <PaymentCoinSettings />
      <Panel title="Fee and revenue wallet">
        <p className="text-sm text-muted-foreground">
          The LamportPay fee and the revenue wallet are managed on{" "}
          <Link to="/admin/fees-revenue" className="text-primary hover:underline">
            Fees & Revenue
          </Link>
          .
        </p>
      </Panel>
      <PaymentLimitSettings />
    </AdminPage>
  );
}
