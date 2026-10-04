-- Phase 3 (C07): payment limits editable from the admin dashboard.
--
-- business_settings.payment_limits: per coin, LamportPay's own minimum and
-- maximum in minor units, e.g.
--   {"usdc": {"min_minor": 100000000, "max_minor": null}}
-- max_minor null = no LamportPay maximum (Stables' own limits decide). A coin
-- that is absent uses .env (PAYMENT_MIN_* / PAYMENT_MAX_*). NULL column = .env
-- for every coin. The server validates the values before saving (min > 0,
-- max >= min) and refuses to run payments on an invalid combination; the check
-- below keeps the shape sane even for direct writes.

alter table public.business_settings
  add column payment_limits jsonb check (
    payment_limits is null
    or (
      jsonb_typeof(payment_limits) = 'object'
      and (payment_limits - 'usdc' - 'usdt') = '{}'::jsonb
    )
  );
