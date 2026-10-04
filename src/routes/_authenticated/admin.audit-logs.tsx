import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import {
  AdminPage,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
} from "@/components/admin/AdminShell";
import { ENTITY_LABELS } from "@/lib/admin.constants";
import { getAuditLogAdmin } from "@/lib/admin-ops.functions";

export const Route = createFileRoute("/_authenticated/admin/audit-logs")({
  head: () => ({ meta: [{ title: "Audit logs | LamportPay Admin" }] }),
  component: AuditLogsPage,
});

function AuditLogsPage() {
  const [entityType, setEntityType] = useState("");
  const [search, setSearch] = useState("");
  const fetchLog = useServerFn(getAuditLogAdmin);
  const query = useQuery({
    queryKey: ["admin-audit-log", entityType],
    queryFn: () => fetchLog({ data: { limit: 200, ...(entityType && { entityType }) } }),
  });
  const needle = search.trim().toLowerCase();
  const rows = (query.data ?? []).filter(
    (r) =>
      !needle ||
      [r.actor_email, r.action, r.field, r.old_value, r.new_value, r.note, r.entity_reference]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
  );

  return (
    <AdminPage
      title="Audit logs"
      crumbs={[{ label: "Audit logs" }]}
      description="Every configuration, role and security change made by an admin: who, when, what changed (old → new) and why."
    >
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Filter by area"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">All areas</option>
          {Object.entries(ENTITY_LABELS).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        <input
          aria-label="Search audit log"
          placeholder="Search admin, action, value, reason"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-72 max-w-full rounded-md border border-border bg-background px-3 text-sm"
        />
      </div>
      <Panel>
        {query.isLoading && <LoadingState />}
        {query.isError && <ErrorState error={query.error} />}
        {query.data && rows.length === 0 && <EmptyState>No entries.</EmptyState>}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground text-left">
                <tr>
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Admin</th>
                  <th className="py-2 pr-3 font-medium">Area</th>
                  <th className="py-2 pr-3 font-medium">Change</th>
                  <th className="py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 align-top">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-xs">{r.actor_email ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs">
                      {ENTITY_LABELS[r.entity_type] ?? r.entity_type}
                      {r.entity_reference && (
                        <div className="text-muted-foreground break-all">{r.entity_reference}</div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      <div className="font-medium">
                        {r.action.replace(/_/g, " ")}
                        {r.field && ` · ${r.field}`}
                      </div>
                      {(r.old_value || r.new_value) && (
                        <div className="text-muted-foreground break-all">
                          {r.old_value ?? "—"} → {r.new_value ?? "—"}
                        </div>
                      )}
                    </td>
                    <td className="py-2 text-xs">{r.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </AdminPage>
  );
}
