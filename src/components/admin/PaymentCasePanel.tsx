import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ClipboardList, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatMinor, toMinor } from "@/lib/money";
import {
  getPaymentCasesAdmin,
  openPaymentCaseAdmin,
  recheckStablesAdmin,
  updatePaymentCaseAdmin,
  type AdminCase,
  type AdminCaseEvent,
} from "@/lib/payment-cases.functions";
import {
  allowedNextStatuses,
  CASE_KIND_LABELS,
  CASE_KINDS,
  CASE_STATUS_LABELS,
  type CaseKind,
  type CaseStatus,
} from "@/lib/payments/cases";

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm disabled:opacity-60";
const areaClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

type FormFields = {
  stables_reference: string;
  original_wallet: string;
  original_amount: string;
  asset: "usdc" | "usdt";
  refund_amount: string;
  refund_destination: string;
  stables_communication: string;
  refund_tx_signature: string;
};

function major(minor: number | null, asset: string | null) {
  return minor === null ? "" : formatMinor(BigInt(minor), asset ?? "usdc").replace(/,/g, "");
}

function minorOrNull(value: string, asset: string): number | null {
  const v = value.trim().replace(/,/g, "");
  if (!v) return null;
  return Number(toMinor(v, asset));
}

function toFields(f: FormFields) {
  return {
    stables_reference: f.stables_reference,
    original_wallet: f.original_wallet,
    original_amount_minor: minorOrNull(f.original_amount, f.asset),
    asset: f.asset,
    refund_amount_minor: minorOrNull(f.refund_amount, f.asset),
    refund_destination: f.refund_destination,
    stables_communication: f.stables_communication,
    refund_tx_signature: f.refund_tx_signature,
  };
}

function fromCase(c: AdminCase): FormFields {
  const asset = c.asset === "usdt" ? "usdt" : "usdc";
  return {
    stables_reference: c.stables_reference ?? "",
    original_wallet: c.original_wallet ?? "",
    original_amount: major(c.original_amount_minor, asset),
    asset,
    refund_amount: major(c.refund_amount_minor, asset),
    refund_destination: c.refund_destination ?? "",
    stables_communication: c.stables_communication ?? "",
    refund_tx_signature: c.refund_tx_signature ?? "",
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function CaseFieldsForm({
  value,
  onChange,
  disabled,
}: {
  value: FormFields;
  onChange: (next: FormFields) => void;
  disabled?: boolean;
}) {
  const set = (key: keyof FormFields) => (e: { target: { value: string } }) =>
    onChange({ ...value, [key]: e.target.value });
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label="Stables reference (transfer ID / ticket)">
        <input
          className={inputClass}
          value={value.stables_reference}
          onChange={set("stables_reference")}
          disabled={disabled}
        />
      </Field>
      <Field label="Original sending wallet">
        <input
          className={`${inputClass} font-mono`}
          value={value.original_wallet}
          onChange={set("original_wallet")}
          disabled={disabled}
        />
      </Field>
      <Field label="Asset">
        <select
          className={inputClass}
          value={value.asset}
          onChange={set("asset")}
          disabled={disabled}
        >
          <option value="usdc">USDC</option>
          <option value="usdt">USDT</option>
        </select>
      </Field>
      <Field label="Original amount">
        <input
          className={inputClass}
          inputMode="decimal"
          value={value.original_amount}
          onChange={set("original_amount")}
          disabled={disabled}
        />
      </Field>
      <Field label="Refund amount (as agreed with Stables)">
        <input
          className={inputClass}
          inputMode="decimal"
          value={value.refund_amount}
          onChange={set("refund_amount")}
          disabled={disabled}
        />
      </Field>
      <Field label="Refund destination (as agreed with Stables)">
        <input
          className={inputClass}
          value={value.refund_destination}
          onChange={set("refund_destination")}
          disabled={disabled}
        />
      </Field>
      <Field label="Refund transaction hash (when Stables provides it)">
        <input
          className={`${inputClass} font-mono`}
          value={value.refund_tx_signature}
          onChange={set("refund_tx_signature")}
          disabled={disabled}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Stables communication (thread, email, ticket summary)">
          <textarea
            className={areaClass}
            rows={2}
            value={value.stables_communication}
            onChange={set("stables_communication")}
            disabled={disabled}
          />
        </Field>
      </div>
    </div>
  );
}

function History({ events }: { events: AdminCaseEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ol className="space-y-1">
      {events.map((e) => (
        <li key={e.id} className="text-xs border-b border-border/50 pb-1 last:border-0">
          <span className="font-semibold">
            {e.action.replace(/_/g, " ")}
            {e.to_status && ` → ${CASE_STATUS_LABELS[e.to_status as CaseStatus] ?? e.to_status}`}
          </span>{" "}
          <span className="text-muted-foreground">
            {new Date(e.created_at).toLocaleString()} · {e.actor_email ?? "admin"}
          </span>
          {e.note && <div className="whitespace-pre-wrap">{e.note}</div>}
          {e.changes && (
            <div className="text-muted-foreground font-mono break-all">
              {Object.keys(e.changes as Record<string, unknown>).join(", ")}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function OpenCaseEditor({
  current,
  events,
  onSaved,
}: {
  current: AdminCase;
  events: AdminCaseEvent[];
  onSaved: () => void;
}) {
  const update = useServerFn(updatePaymentCaseAdmin);
  const [fields, setFields] = useState<FormFields>(() => fromCase(current));
  const [next, setNext] = useState<CaseStatus | "">("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () =>
      update({
        data: {
          caseId: current.id,
          ...(next && { status: next }),
          fields: toFields(fields),
          ...(note.trim() && { note: note.trim() }),
        },
      }),
    onSuccess: () => {
      toast.success("Case updated");
      setNext("");
      setNote("");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const options = allowedNextStatuses(current.status);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">
          {CASE_KIND_LABELS[current.kind as CaseKind] ?? current.kind}
        </span>
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
          {CASE_STATUS_LABELS[current.status]}
        </span>
        <span className="text-xs text-muted-foreground">
          opened {new Date(current.created_at).toLocaleString()}
        </span>
      </div>
      <p className="text-xs whitespace-pre-wrap">{current.reason}</p>
      <CaseFieldsForm value={fields} onChange={setFields} disabled={save.isPending} />
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Move case to">
          <select
            className={inputClass}
            value={next}
            onChange={(e) => setNext(e.target.value as CaseStatus | "")}
            disabled={save.isPending}
          >
            <option value="">(keep: {CASE_STATUS_LABELS[current.status]})</option>
            {options.map((s) => (
              <option key={s} value={s}>
                {CASE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={next === "closed" ? "How was it resolved? (required)" : "Note"}>
          <textarea
            className={areaClass}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={save.isPending}
          />
        </Field>
      </div>
      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save case"}
      </Button>
      <History events={events} />
    </div>
  );
}

function NewCaseForm({
  paymentId,
  prefill,
  suggestedKind,
  onSaved,
}: {
  paymentId: string;
  prefill: {
    stables_reference: string | null;
    original_wallet: string | null;
    original_amount_minor: number | null;
    asset: "usdc" | "usdt";
  };
  suggestedKind: CaseKind;
  onSaved: () => void;
}) {
  const open = useServerFn(openPaymentCaseAdmin);
  const [kind, setKind] = useState<CaseKind>(suggestedKind);
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<FormFields>({
    stables_reference: prefill.stables_reference ?? "",
    original_wallet: prefill.original_wallet ?? "",
    original_amount: major(prefill.original_amount_minor, prefill.asset),
    asset: prefill.asset,
    refund_amount: "",
    refund_destination: "",
    stables_communication: "",
    refund_tx_signature: "",
  });
  const save = useMutation({
    mutationFn: () =>
      open({ data: { paymentId, kind, reason: reason.trim(), fields: toFields(fields) } }),
    onSuccess: () => {
      toast.success("Case opened");
      setReason("");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Case type">
          <select
            className={inputClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as CaseKind)}
          >
            {CASE_KINDS.map((k) => (
              <option key={k} value={k}>
                {CASE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reason (required)">
          <textarea
            className={areaClass}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
      <CaseFieldsForm value={fields} onChange={setFields} disabled={save.isPending} />
      <Button
        size="sm"
        onClick={() => save.mutate()}
        disabled={save.isPending || reason.trim().length < 3}
      >
        {save.isPending ? "Opening…" : "Open case"}
      </Button>
    </div>
  );
}

const SEVERITY_TONE = {
  critical: "border-destructive/30 bg-destructive/10",
  warning: "border-amber-500/30 bg-amber-500/10",
  info: "border-border/60 bg-muted/40",
} as const;

/**
 * Operations for one payment: alerts, "Recheck Stables", and the manual case
 * workflow (refunds/returns are coordinated with Stables; LamportPay never
 * moves customer funds).
 */
export function PaymentCasePanel({
  paymentId,
  onRechecked,
}: {
  paymentId: string;
  onRechecked?: () => void;
}) {
  const fetchCases = useServerFn(getPaymentCasesAdmin);
  const recheck = useServerFn(recheckStablesAdmin);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-payment-cases", paymentId],
    queryFn: () => fetchCases({ data: { paymentId } }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-payment-cases", paymentId] });
    void queryClient.invalidateQueries({ queryKey: ["admin-stables-payments"] });
  };
  const recheckMutation = useMutation({
    mutationFn: () => recheck({ data: { paymentId } }),
    onSuccess: (r) => {
      toast.success(
        r.before === r.after
          ? `Stables reports no change (${r.after.replace(/_/g, " ").toLowerCase()}).`
          : `Updated from Stables: ${r.before} → ${r.after}.`,
      );
      refresh();
      onRechecked?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data = query.data;
  const openCase = data?.cases.find((c) => c.status !== "closed") ?? null;
  const closed = data?.cases.filter((c) => c.status === "closed") ?? [];
  const codes = new Set((data?.signals ?? []).map((s) => s.code));
  const suggestedKind: CaseKind = codes.has("deposit_mismatch")
    ? "wrong_amount"
    : codes.has("ended_after_funds")
      ? "refund"
      : codes.has("compliance_hold")
        ? "compliance"
        : codes.has("stables_very_slow") || codes.has("stables_slow")
          ? "stuck"
          : "other";

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-primary" />
          Operations
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => recheckMutation.mutate()}
          disabled={recheckMutation.isPending}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 mr-2 ${recheckMutation.isPending ? "animate-spin" : ""}`}
          />
          Recheck Stables
        </Button>
      </div>

      {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {query.isError && (
        <p className="text-sm text-destructive">{(query.error as Error).message}</p>
      )}

      {data && (
        <>
          {data.signals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts for this payment.</p>
          ) : (
            <ul className="space-y-2">
              {data.signals.map((s) => (
                <li
                  key={s.code}
                  className={`rounded-xl border px-4 py-2 text-sm ${SEVERITY_TONE[s.severity]}`}
                >
                  <div className="font-semibold flex items-center gap-2">
                    {s.severity !== "info" && <AlertTriangle className="w-4 h-4 shrink-0" />}
                    {s.label}
                  </div>
                  <div className="text-xs text-muted-foreground">{s.action}</div>
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-xl border border-border/60 bg-secondary/40 p-3 text-xs">
            Refunds and returns are manual. LamportPay never holds or moves customer funds: Stables'
            operations team returns funds, and the destination and amount are agreed case by case.
            Record here what was agreed and when the customer was told. A case never changes the
            payment status, which always follows Stables.
          </div>

          {openCase ? (
            <OpenCaseEditor
              key={`${openCase.id}-${openCase.updated_at}`}
              current={openCase}
              events={data.events.filter((e) => e.case_id === openCase.id)}
              onSaved={refresh}
            />
          ) : (
            <NewCaseForm
              key={suggestedKind}
              paymentId={paymentId}
              prefill={data.prefill}
              suggestedKind={suggestedKind}
              onSaved={refresh}
            />
          )}

          {closed.length > 0 && (
            <details>
              <summary className="text-sm cursor-pointer">Closed cases ({closed.length})</summary>
              <div className="mt-2 space-y-3">
                {closed.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl border border-border/60 p-3 space-y-1 text-xs"
                  >
                    <div className="font-semibold">
                      {CASE_KIND_LABELS[c.kind as CaseKind] ?? c.kind} · closed{" "}
                      {c.closed_at ? new Date(c.closed_at).toLocaleString() : ""}
                    </div>
                    <div className="whitespace-pre-wrap">{c.reason}</div>
                    <History events={data.events.filter((e) => e.case_id === c.id)} />
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
