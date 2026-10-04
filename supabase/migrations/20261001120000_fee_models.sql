-- Phase 3 (C05): configurable fee models.
--
-- LamportPay's fee stays ONE fee per payment. Its amount is a percentage of the
-- amount converted, optionally kept within a minimum and a maximum:
--   fee = clamp(ceil(amount * bps / 10000), min, max)
-- A fixed fee is bps = 0 with min = max. With no min and no max (the default)
-- the fee is the plain percentage, i.e. the approved 2% model is unchanged.
--
-- business_settings.platform_fee_{min,max}_minor: admin overrides in the payment
-- coin's minor units (USDC/USDT have 6 decimals). NULL = use .env
-- (LAMPORTPAY_FEE_MIN / LAMPORTPAY_FEE_MAX); 0 = explicitly no bound.
--
-- payments.platform_fee_{min,max}_minor / platform_fee_rule: the model in force
-- when the payment was quoted, and which part of it decided the fee. Locked with
-- the rest of the pricing once the pricing snapshot is taken.

alter table public.business_settings
  add column platform_fee_min_minor bigint check (platform_fee_min_minor >= 0),
  add column platform_fee_max_minor bigint check (platform_fee_max_minor >= 0),
  add constraint business_settings_fee_bounds_order check (
    platform_fee_min_minor is null
    or platform_fee_max_minor is null
    or platform_fee_max_minor = 0
    or platform_fee_min_minor <= platform_fee_max_minor
  );

alter table public.payments
  add column platform_fee_min_minor bigint check (platform_fee_min_minor > 0),
  add column platform_fee_max_minor bigint check (platform_fee_max_minor > 0),
  add column platform_fee_rule text check (
    platform_fee_rule in ('none', 'percentage', 'minimum', 'maximum')
  );

create or replace function public.payments_pricing_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.pricing_snapshot is not null and (
       new.pricing_snapshot is distinct from old.pricing_snapshot
    or new.platform_fee_bps is distinct from old.platform_fee_bps
    or new.platform_fee_minor is distinct from old.platform_fee_minor
    or new.platform_fee_wallet is distinct from old.platform_fee_wallet
    or new.platform_fee_min_minor is distinct from old.platform_fee_min_minor
    or new.platform_fee_max_minor is distinct from old.platform_fee_max_minor
    or new.platform_fee_rule is distinct from old.platform_fee_rule
  ) then
    raise exception 'the pricing of payment % is fixed', old.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.payments_pricing_immutable() from public, anon, authenticated;
