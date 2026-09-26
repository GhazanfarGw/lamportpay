-- Payments can be funded in USDT as well as USDC (both on Solana, both settled
-- by Stables). Keep in sync with PAYMENT_CURRENCIES in src/lib/tokens.ts.
-- Additive on top of 20260926190000_customer_name.sql: widens a check only.

alter table public.payments drop constraint payments_source_currency_check;
alter table public.payments add constraint payments_source_currency_check
  check (source_currency in ('usdc', 'usdt'));
