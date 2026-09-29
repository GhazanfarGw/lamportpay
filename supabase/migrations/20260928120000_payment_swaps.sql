-- Phase 2: wallet settlement and payment-bound swaps (docs/wallet-settlement-design.md).
--
-- A swap converts what the user holds into the settlement coin Stables priced,
-- inside the user's own wallet: LamportPay never receives or routes the funds.
-- The user signs every swap in their wallet; the server only relays the signed
-- transaction and checks the result on-chain. One row per attempt.
--
-- Also records which coin and network Stables' deposit instructions name, so
-- funding and verification follow Stables' response rather than our request.
-- Additive on top of 20260926230000_phase2_grants_hardening.sql.

alter table public.payments
  add column deposit_currency text check (deposit_currency in ('usdc', 'usdt')),
  add column deposit_network text check (deposit_network = 'solana');

create table public.payment_swaps (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  attempt int not null check (attempt > 0),
  status text not null default 'ordered' check (status in (
    'ordered', 'submitted', 'landed', 'failed', 'expired', 'abandoned'
  )),
  -- The order, as Jupiter built it for the user's own wallet (the taker).
  taker text not null,
  input_mint text not null,
  output_mint text not null,
  swap_mode text not null check (swap_mode in ('ExactIn', 'ExactOut')),
  shortfall_minor bigint not null check (shortfall_minor > 0),
  in_amount_minor bigint not null check (in_amount_minor > 0),
  -- Guaranteed minimum output; must cover the shortfall or the order is refused.
  min_out_minor bigint not null,
  slippage_bps int,
  price_impact_pct numeric,
  jupiter_request_id text not null unique,
  -- The unsigned transaction the user is asked to sign, and its message hash:
  -- only a signed transaction with exactly this message is relayed.
  order_transaction text not null,
  order_message_sha256 text not null,
  last_valid_block_height bigint,
  -- The result. actual_*_minor come from the finalized transaction's balance
  -- changes, never from Jupiter's report.
  signature text unique,
  jupiter_status text,
  jupiter_error text,
  actual_in_minor bigint,
  actual_out_minor bigint,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, attempt),
  check (min_out_minor >= shortfall_minor)
);

-- At most one swap per payment may be in flight (signed and relayed, outcome
-- not yet final): a double click or a second tab cannot swap twice.
create unique index payment_swaps_one_in_flight on public.payment_swaps (payment_id)
  where status = 'submitted';
create index payment_swaps_payment_idx on public.payment_swaps (payment_id, attempt desc);

drop trigger if exists trg_payment_swaps_touch on public.payment_swaps;
create trigger trg_payment_swaps_touch before update on public.payment_swaps
for each row execute function public.touch_updated_at();

-- Same access model as the other Phase 2 tables: the server writes with the
-- service role; the payment's owner and admins can read.
alter table public.payment_swaps enable row level security;
revoke all on public.payment_swaps from anon;
revoke all on public.payment_swaps from authenticated;
grant select on public.payment_swaps to authenticated;
grant all on public.payment_swaps to service_role;

create policy "Users read own payment swaps" on public.payment_swaps
  for select to authenticated
  using (exists (
    select 1 from public.payments p
    where p.id = payment_id and (p.user_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
  ));
