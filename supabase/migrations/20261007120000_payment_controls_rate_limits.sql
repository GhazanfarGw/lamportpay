-- 1. Emergency controls (global pause, per-currency pause, per-corridor limits),
--    kept per mode so TEST/sandbox rules never mix with LIVE/production rules:
--    { "test": { "paused": bool, "reason": text, "corridors": { "INR": { "paused": bool,
--      "reason": text, "min_minor": int|null, "max_minor": int|null } } }, "live": { ... } }
--    Validated in src/lib/payments/controls.ts; enforced server-side on payment creation,
--    quote, transfer and the in-app funding transaction.
alter table public.business_settings
  add column if not exists payment_controls jsonb
  check (payment_controls is null or jsonb_typeof(payment_controls) = 'object');

-- 2. Platform-wide rate limiting: one fixed-window counter per (bucket, key, window),
--    shared by every server instance. Written only through rate_limit_hit (service role).
create table if not exists public.rate_limit_buckets (
  bucket text not null check (length(bucket) <= 64),
  key text not null check (length(key) <= 200),
  window_start timestamptz not null,
  count integer not null default 1,
  primary key (bucket, key, window_start)
);
create index if not exists rate_limit_buckets_window_idx on public.rate_limit_buckets (window_start);

alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from anon, authenticated;
grant all on public.rate_limit_buckets to service_role;

-- Atomic: count this call and say whether it is within the limit.
create or replace function public.rate_limit_hit(
  p_bucket text, p_key text, p_limit integer, p_window_seconds integer
) returns boolean
language sql
security definer
set search_path = ''
as 'insert into public.rate_limit_buckets as r (bucket, key, window_start, count)
    values (p_bucket, p_key,
            to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds),
            1)
    on conflict (bucket, key, window_start) do update set count = r.count + 1
    returning r.count <= p_limit';
revoke all on function public.rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, integer, integer) to service_role;

-- Old windows are removed by the reconciliation job.
create or replace function public.rate_limit_prune(p_older_than_seconds integer default 3600)
returns integer
language sql
security definer
set search_path = ''
as 'with gone as (
      delete from public.rate_limit_buckets
      where window_start < now() - make_interval(secs => p_older_than_seconds)
      returning 1)
    select count(*)::integer from gone';
revoke all on function public.rate_limit_prune(integer) from public, anon, authenticated;
grant execute on function public.rate_limit_prune(integer) to service_role;
