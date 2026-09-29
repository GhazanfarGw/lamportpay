-- Phase 3: admin-editable business settings and LamportPay's own fee per payment.
--
-- business_settings: one row. A NULL column means "use the .env default"
-- (LAMPORTPAY_FEE_BPS, LAMPORTPAY_SWAP_FEE_BPS, LAMPORTPAY_REVENUE_WALLET,
-- PAYMENT_ENABLED_CURRENCIES). Server-only: admins change it through the admin
-- dashboard's server functions (role checked, audit logged); users get no access.
-- No secrets are stored here — the revenue wallet is a public address.
--
-- payments.platform_fee_*: the fee snapshot taken with the quote, so a later
-- settings change never alters a payment the user already agreed to.
-- Non-custodial: the fee is a separate transfer, in the same user-signed
-- transaction, from the user's wallet to the revenue wallet. The Stables deposit
-- goes straight from the user's wallet to Stables.

create table public.business_settings (
  id boolean primary key default true check (id),
  conversion_fee_bps integer check (conversion_fee_bps between 0 and 1000),
  swap_fee_bps integer check (swap_fee_bps = 0 or swap_fee_bps between 50 and 255),
  revenue_wallet text check (revenue_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  enabled_currencies text[] check (
    enabled_currencies is null
    or (cardinality(enabled_currencies) > 0 and enabled_currencies <@ array['usdc', 'usdt'])
  ),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.business_settings enable row level security;
revoke all on public.business_settings from anon;
revoke all on public.business_settings from authenticated;
grant all on public.business_settings to service_role;

alter table public.payments
  add column platform_fee_bps integer check (platform_fee_bps between 0 and 1000),
  add column platform_fee_minor bigint check (platform_fee_minor >= 0),
  add column platform_fee_wallet text,
  add column platform_fee_received_minor bigint check (platform_fee_received_minor >= 0);

comment on column public.payments.platform_fee_minor is
  'LamportPay fee in the deposit coin''s minor units, added on top of the Stables deposit.';
comment on column public.payments.platform_fee_received_minor is
  'What the revenue wallet actually received in the verified funding transaction.';
