-- Phase 2 security fix: public.has_role(uuid, app_role) is SECURITY DEFINER and
-- executable by every signed-in user (Supabase advisor 0029). Before this, any
-- user could call /rest/v1/rpc/has_role with ANY user id and learn whether that
-- user is an admin.
--
-- Every caller in the app and every RLS policy asks about the caller itself
-- (has_role(auth.uid(), ...)), so the answer is now limited to: the caller's own
-- roles, or anything when the request comes with the service-role key. Same
-- signature, same SECURITY DEFINER (needed: user_roles policies call it), same
-- grants; policies and app code are unchanged.
--
-- Rollback: re-run the original definition from
-- 20260825170332_d9572f9a-1760-4787-8547-673f74907ba8.sql.

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id
      and role = _role
      and (_user_id = auth.uid() or coalesce(auth.role(), '') = 'service_role')
  )
$$;
