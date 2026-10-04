-- Phase 3 (C06): signed-out visitors get no grant on the admin audit log.
-- RLS already blocked them (policies are for authenticated only); least privilege.
revoke all on public.admin_audit_log from anon;
