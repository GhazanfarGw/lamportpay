-- rls_auto_enable() is the SECURITY DEFINER event-trigger function Supabase creates to
-- turn on RLS for new public tables. It came with EXECUTE for PUBLIC and anon, which
-- exposes it as /rest/v1/rpc/rls_auto_enable to signed-out callers (security advisor
-- lint 0028). The event trigger does not need these grants to fire.
-- Guarded so it is a no-op on a project that has no such function.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon;
  end if;
end
$$;
