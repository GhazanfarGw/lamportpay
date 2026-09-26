-- Phase 2: Stables payments ledger.
--
-- Record-keeping only: amounts, quote, fees, partner IDs and statuses. No
-- balances and no double-entry. LamportPay never holds funds; users send USDC
-- straight to the single-use deposit address Stables returns per transfer.
--
-- Amounts are integer minor units (USDC: 6 decimals; fiat: ISO 4217 exponent).
-- Raw partner responses are kept in *_snapshot columns for reconciliation.
-- All writes go through the server with the service role; users can only read
-- their own rows.

-- One Stables customer per LamportPay user.
create table public.stables_customers (
  user_id uuid primary key references auth.users(id) on delete restrict,
  stables_customer_id text not null unique,
  verification_status text,
  verification_sub_status text[],
  base_payout_status text,
  kyc_link text,
  kyc_link_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,

  -- Keep in sync with src/lib/payments/state.ts.
  status text not null default 'PAYMENT_CREATED' check (status in (
    'PAYMENT_CREATED', 'KYC_PENDING', 'KYC_APPROVED', 'QUOTED', 'KYC_REJECTED',
    'CREATED', 'COMPLIANCE_HOLD', 'AWAITING_FUNDS_COLLECTION', 'FUNDS_COLLECTED',
    'IN_PROGRESS', 'PAYMENT_SUBMITTED', 'PAYMENT_PROCESSED',
    'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'
  )),
  -- State the transfer was in when it entered COMPLIANCE_HOLD; it resumes at or after it.
  pre_hold_status text,

  source_currency text not null default 'usdc' check (source_currency = 'usdc'),
  source_network text not null default 'solana' check (source_network = 'solana'),
  source_amount_minor bigint not null check (source_amount_minor > 0),

  destination_currency text not null,
  destination_country text not null check (destination_country ~ '^[A-Z]{2}$'),
  destination_amount_minor bigint,
  exchange_rate numeric,
  -- { "<fee kind>": { "amount_minor": <int>, "currency": "<code>" } }
  fees jsonb,

  stables_customer_id text,
  quote_id text,
  quote_expires_at timestamptz,
  quote_snapshot jsonb,
  transfer_id text unique,
  transfer_snapshot jsonb,
  purpose_code text,
  -- Holder name, bank, country and a masked account number. Full bank details
  -- go to Stables and are not stored here.
  beneficiary_summary jsonb,

  deposit_address text,
  deposit_amount_minor bigint,
  funding_signature text unique,
  funding_payer text,
  funding_verified_at timestamptz,

  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_user_created_idx on public.payments (user_id, created_at desc);
create index payments_status_idx on public.payments (status);

-- Append-only timeline: every transition, rejected transition and partner call.
create table public.payment_events (
  id bigint generated always as identity primary key,
  payment_id uuid not null references public.payments(id) on delete cascade,
  kind text not null,
  from_status text,
  to_status text,
  source text not null check (source in ('api', 'webhook')),
  detail jsonb,
  created_at timestamptz not null default now()
);

create index payment_events_payment_idx on public.payment_events (payment_id, id);

-- Webhook deliveries, deduplicated by Stables' event_id.
create table public.stables_webhook_events (
  event_id text primary key,
  event_type text not null,
  event_object_id text,
  event_object_status text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  process_error text
);

drop trigger if exists trg_stables_customers_touch on public.stables_customers;
create trigger trg_stables_customers_touch before update on public.stables_customers
for each row execute function public.touch_updated_at();

drop trigger if exists trg_payments_touch on public.payments;
create trigger trg_payments_touch before update on public.payments
for each row execute function public.touch_updated_at();

alter table public.stables_customers enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.stables_webhook_events enable row level security;

grant select on public.stables_customers, public.payments, public.payment_events to authenticated;
grant all on public.stables_customers, public.payments, public.payment_events,
  public.stables_webhook_events to service_role;

create policy "Users read own Stables customer" on public.stables_customers
  for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

create policy "Users read own payments" on public.payments
  for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

create policy "Users read own payment events" on public.payment_events
  for select to authenticated
  using (exists (
    select 1 from public.payments p
    where p.id = payment_id and (p.user_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
  ));
