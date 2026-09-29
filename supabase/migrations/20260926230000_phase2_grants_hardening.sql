-- Phase 2 tables are written only by the server (service role); signed-in users
-- read their own rows through RLS, and admins read all of them. Supabase's
-- default privileges had granted anon and authenticated every privilege on these
-- tables (RLS still refused the writes); narrow the grants to that design.
--
-- Also revoke EXECUTE on rls_auto_enable() from authenticated (security advisor
-- lint 0029; 20260926220000 revoked it from public and anon). It returns
-- event_trigger, so it cannot be called directly anyway, and the event trigger
-- does not need the grant to fire.
-- Additive on top of 20260926220000_revoke_rls_auto_enable.sql.

revoke all on public.payments, public.payment_events, public.stables_customers,
  public.stables_webhook_events from anon;

revoke insert, update, delete, truncate, references, trigger on public.payments,
  public.payment_events, public.stables_customers, public.stables_webhook_events
  from authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from authenticated;
  end if;
end
$$;
