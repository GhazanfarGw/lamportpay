/**
 * C06 regression guard: the admin audit log must stay append-only in the
 * database. Behaviour was verified against the dev database (update, delete and
 * truncate refused; back-dated created_at replaced; the FK "actor_id → null" on
 * user deletion still allowed). This test keeps the migration from being
 * weakened unnoticed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../supabase/migrations/20261001130000_admin_audit_log_append_only.sql", import.meta.url),
  "utf8",
);
const anon = readFileSync(
  new URL("../supabase/migrations/20261001130100_admin_audit_log_revoke_anon.sql", import.meta.url),
  "utf8",
);

describe("admin_audit_log is append-only", () => {
  it("refuses UPDATE and DELETE row by row, and TRUNCATE", () => {
    expect(sql).toMatch(/before update or delete on public\.admin_audit_log/);
    expect(sql).toMatch(/before truncate on public\.admin_audit_log/);
    expect(sql).toMatch(/raise exception 'admin_audit_log is append-only/);
  });

  it("only lets the foreign key clear actor_id, with nothing else changed", () => {
    expect(sql).toMatch(/new\.actor_id is null/);
    expect(sql).toMatch(/\(to_jsonb\(new\) - 'actor_id'\) = \(to_jsonb\(old\) - 'actor_id'\)/);
  });

  it("stamps created_at with database time and grants no update/delete", () => {
    expect(sql).toMatch(/new\.created_at := now\(\)/);
    expect(sql).toMatch(
      /revoke update, delete, truncate on public\.admin_audit_log from anon, authenticated, service_role/,
    );
    expect(anon).toMatch(/revoke all on public\.admin_audit_log from anon/);
  });
});
