-- Phase 3 (C06): the admin audit log is append-only in the database.
--
-- Before: RLS let admins only SELECT and INSERT their own rows, but the
-- service role (and table owners) could still UPDATE or DELETE entries.
-- Now, for every role that goes through the table's triggers:
--   * UPDATE and DELETE are refused, with one exception: when an admin's auth
--     user is deleted, the foreign key sets actor_id to NULL. That update is
--     allowed only if nothing else changes (actor_email keeps who it was).
--   * TRUNCATE is refused.
--   * created_at is always the database time of the insert (no back-dating).
-- Same pattern as payment_fee_ledger (20260930150000). A database superuser can
-- still disable triggers; that is outside what an application can prevent and
-- is covered by Supabase access control and backups.

create or replace function public.admin_audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.actor_id is not null
     and new.actor_id is null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new; -- ON DELETE SET NULL from auth.users
  end if;
  raise exception 'admin_audit_log is append-only (% refused)', tg_op;
end;
$$;

create or replace function public.admin_audit_log_truncate_blocked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit_log is append-only (TRUNCATE refused)';
end;
$$;

create or replace function public.admin_audit_log_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create trigger trg_admin_audit_log_append_only
  before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_append_only();

create trigger trg_admin_audit_log_no_truncate
  before truncate on public.admin_audit_log
  for each statement execute function public.admin_audit_log_truncate_blocked();

create trigger trg_admin_audit_log_stamp
  before insert on public.admin_audit_log
  for each row execute function public.admin_audit_log_stamp();

-- Least privilege as well: nobody is granted UPDATE, DELETE or TRUNCATE.
revoke update, delete, truncate on public.admin_audit_log from anon, authenticated, service_role;

revoke execute on function public.admin_audit_log_append_only() from public, anon, authenticated;
revoke execute on function public.admin_audit_log_truncate_blocked() from public, anon, authenticated;
revoke execute on function public.admin_audit_log_stamp() from public, anon, authenticated;
