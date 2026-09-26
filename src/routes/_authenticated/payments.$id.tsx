import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { SiteLayout } from "@/components/site/Layout";
import { PaymentReceipt } from "@/components/site/PaymentReceipt";
import { paymentApi } from "@/lib/payments/api-client";
import type { PaymentView } from "@/lib/payments/view";

export const Route = createFileRoute("/_authenticated/payments/$id")({
  head: () => ({
    meta: [
      { title: "Payment receipt | LamportPay" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ReceiptPage,
});

/** The user's receipt for one payment (their own payments only; the API checks). */
function ReceiptPage() {
  const { id } = Route.useParams();
  const payment = useQuery({
    queryKey: ["payment", id],
    queryFn: async () => (await paymentApi<PaymentView>(`/api/payments/${id}`)).data,
  });
  const p = payment.data;

  return (
    <SiteLayout>
      <div className="max-w-3xl mx-auto px-5 py-14 md:py-20 space-y-6">
        <Link
          to="/payments"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline print:hidden"
        >
          <ArrowLeft className="w-4 h-4" />
          Payment history
        </Link>

        {payment.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {payment.error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
            {(payment.error as Error).message}
          </div>
        )}
        {p && p.status !== "COMPLETED" && (
          <div className="rounded-xl border border-border/60 bg-secondary/60 px-4 py-3 text-sm print:hidden">
            This payment is not completed, so this is not a final receipt.{" "}
            <Link to="/pay" search={{ payment: p.id }} className="text-primary underline">
              Open the payment
            </Link>
          </div>
        )}
        {p && (
          <PaymentReceipt
            payment={p}
            mode="receipt"
            senderName={p.beneficiary?.account_holder_name ?? null}
            account={{
              holderName: p.beneficiary?.account_holder_name ?? null,
              bankName: p.beneficiary?.bank_name ?? null,
              kind: p.beneficiary?.account_kind ?? null,
              number: p.beneficiary?.account ?? null,
            }}
          />
        )}
      </div>
    </SiteLayout>
  );
}
