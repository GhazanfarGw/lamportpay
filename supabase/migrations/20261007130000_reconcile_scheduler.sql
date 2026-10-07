-- Background reconciliation every 5 minutes, independent of the hosting plan.
--
-- Vercel Hobby only runs cron jobs once a day (the daily Vercel cron in
-- vite.config.ts stays as a backstop). Supabase's pg_cron calls the deployed
-- reconciliation endpoint over HTTPS (pg_net) with the cron secret, so payments
-- nobody has open still follow Stables within minutes.
--
-- Inert until configured: the function does nothing unless BOTH Vault secrets
-- exist. To enable on an environment (run once, in the SQL editor):
--   select vault.create_secret('https://<host>/api/cron/reconcile-payments',
--                              'lamportpay_reconcile_url');
--   select vault.create_secret('<the CRON_SECRET of that deployment>',
--                              'lamportpay_cron_secret');
-- The endpoint is idempotent (forward-only state machine, deduplicated
-- webhooks), so overlapping runs are safe.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_payment_reconciliation()
returns bigint
language plpgsql
security definer
set search_path = ''
as 'declare
  v_url text;
  v_secret text;
  v_request bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = ''lamportpay_reconcile_url'';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = ''lamportpay_cron_secret'';
  if v_url is null or v_secret is null or v_url not like ''https://%'' then
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      ''Authorization'', ''Bearer '' || v_secret,
      ''Content-Type'', ''application/json''),
    body := ''{}''::jsonb,
    timeout_milliseconds := 55000
  ) into v_request;
  return v_request;
end;';

revoke all on function public.trigger_payment_reconciliation() from public, anon, authenticated;

select cron.schedule(
  'lamportpay-reconcile-payments',
  '*/5 * * * *',
  'select public.trigger_payment_reconciliation()'
);
