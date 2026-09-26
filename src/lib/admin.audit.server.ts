import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export type AuditEntry = {
  entityType: "kyc_submission" | "payout_transfer" | "user_role" | "admin_invite";
  entityId?: string | null;
  entityReference?: string | null;
  action: string;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  note?: string | null;
};

/**
 * Appends admin actions to the audit log. Never throws: a logging failure must
 * not roll back or hide the operation the admin actually performed.
 */
export async function logAdminActions(
  supabase: SupabaseClient<Database>,
  actor: { id: string; email?: string | null },
  entries: AuditEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  const rows = entries.map((entry) => ({
    actor_id: actor.id,
    actor_email: actor.email ?? null,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    entity_reference: entry.entityReference ?? null,
    action: entry.action,
    field: entry.field ?? null,
    old_value: entry.oldValue ?? null,
    new_value: entry.newValue ?? null,
    note: entry.note ?? null,
  }));

  const { error } = await supabase.from("admin_audit_log").insert(rows);
  if (error) console.error("[admin-audit] failed to write audit entries", error.message);
}
