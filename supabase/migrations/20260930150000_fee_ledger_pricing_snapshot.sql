-- Revenue engine: an append-only fee ledger and an immutable pricing snapshot.
--
-- payment_fee_ledger: one row per fee component of a payment, by category:
--   lamportpay_fee  LamportPay's one total fee (owner decision: 2% in total,
--                   covering conversion and any swap — never 2% + 2%)
--   partner_fee     what the Stables quote/transfer says Stables charges
--   swap_fee        a LamportPay fee collected inside a swap (none today: the
--                   one total fee is collected in the funding transaction)
-- entry_type: 'expected' (fixed when the transfer is created) or 'received'
-- (seen on-chain in the verified funding transaction). Rows are never
-- updated or deleted; duplicates are ignored by the unique key, so writes are
-- idempotent. Server-only writes; admins can read.
--
-- payments.pricing_snapshot: the full price the user agreed to (Stables quote,
-- partner fees, LamportPay fee, total), written once when the transfer is
-- created. After that, it and the platform_fee_* columns cannot change.

create table public.payment_fee_ledger (
  id bigint generated always as identity primary key,
  payment_id uuid not null references public.payments(id) on delete restrict,
  category text not null check (category in ('lamportpay_fee', 'partner_fee', 'swap_fee')),
  entry_type text not null check (entry_type in ('expected', 'received')),
  component text not null default '',
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null,
  bps integer check (bps between 0 and 10000),
  reference text,
  created_at timestamptz not null default now(),
  unique (payment_id, category, entry_type, component)
);

create index payment_fee_ledger_created_idx on public.payment_fee_ledger (created_at desc);

alter table public.payment_fee_ledger enable row level security;
revoke all on public.payment_fee_ledger from anon, authenticated;
grant select on public.payment_fee_ledger to authenticated;
grant all on public.payment_fee_ledger to service_role;

create policy "Admins read the fee ledger" on public.payment_fee_ledger
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

create or replace function public.fee_ledger_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'payment_fee_ledger is append-only';
end;
$$;

create trigger trg_fee_ledger_append_only
  before update or delete on public.payment_fee_ledger
  for each row execute function public.fee_ledger_append_only();

alter table public.payments add column pricing_snapshot jsonb;

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
  ) then
    raise exception 'the pricing of payment % is fixed', old.id;
  end if;
  return new;
end;
$$;

create trigger trg_payments_pricing_immutable
  before update on public.payments
  for each row execute function public.payments_pricing_immutable();

revoke execute on function public.fee_ledger_append_only() from public, anon, authenticated;
revoke execute on function public.payments_pricing_immutable() from public, anon, authenticated;
