-- Operations cases: the manual workflow for payments that need a person
-- (refunds/returns, wrong deposit amounts, returned payouts, compliance, KYC,
-- stuck payments). A case sits next to a payment and never changes its status,
-- which keeps mirroring Stables. LamportPay never moves customer funds:
-- Stables returns funds manually with its operations team; a case records that
-- coordination. Keep in sync with src/lib/payments/cases.ts.

create table if not exists public.payment_cases (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  kind text not null check (kind in (
    'refund', 'wrong_amount', 'returned_payout', 'compliance', 'kyc', 'stuck', 'other'
  )),
  status text not null default 'refund_required' check (status in (
    'refund_required', 'refund_requested', 'waiting_for_stables', 'refund_confirmed',
    'refund_failed', 'customer_notified', 'closed'
  )),
  reason text not null check (length(reason) between 3 and 2000),

  stables_reference text check (length(stables_reference) <= 200),
  original_wallet text check (length(original_wallet) <= 64),
  original_amount_minor bigint check (original_amount_minor >= 0),
  asset text check (asset in ('usdc', 'usdt')),
  refund_amount_minor bigint check (refund_amount_minor >= 0),
  refund_destination text check (length(refund_destination) <= 200),
  stables_communication text check (length(stables_communication) <= 2000),
  refund_tx_signature text check (length(refund_tx_signature) <= 100),

  opened_by uuid references auth.users(id) on delete set null,
  customer_notified_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one open case per payment; history stays in closed cases.
create unique index if not exists payment_cases_one_open_per_payment
  on public.payment_cases (payment_id) where status <> 'closed';
create index if not exists payment_cases_status_idx on public.payment_cases (status, created_at desc);
-- A refund transaction belongs to one case only.
create unique index if not exists payment_cases_refund_tx_unique
  on public.payment_cases (refund_tx_signature) where refund_tx_signature is not null;

drop trigger if exists trg_payment_cases_touch on public.payment_cases;
create trigger trg_payment_cases_touch before update on public.payment_cases
for each row execute function public.touch_updated_at();

-- Append-only history of every case change (who, what, when).
create table if not exists public.payment_case_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.payment_cases(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null check (action in ('opened', 'status_changed', 'updated', 'note')),
  from_status text,
  to_status text,
  note text check (length(note) <= 2000),
  changes jsonb,
  created_at timestamptz not null default now()
);
create index if not exists payment_case_events_case_idx on public.payment_case_events (case_id, id);

alter table public.payment_cases enable row level security;
alter table public.payment_case_events enable row level security;

revoke all on public.payment_cases, public.payment_case_events from anon;
revoke all on public.payment_cases, public.payment_case_events from authenticated;
grant select, insert, update on public.payment_cases to authenticated;
grant select, insert on public.payment_case_events to authenticated;
grant all on public.payment_cases, public.payment_case_events to service_role;

-- Admins only. Customers never read cases (they hold internal notes).
create policy "Admins read payment cases" on public.payment_cases
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));
create policy "Admins open payment cases" on public.payment_cases
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'::app_role) and opened_by = auth.uid());
create policy "Admins update payment cases" on public.payment_cases
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

create policy "Admins read payment case events" on public.payment_case_events
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));
create policy "Admins append payment case events" on public.payment_case_events
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'::app_role) and actor_id = auth.uid());

-- History is append-only, even for the service role.
create or replace function public.payment_case_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'payment_case_events is append-only';
end;
$$;
drop trigger if exists trg_payment_case_events_append_only on public.payment_case_events;
create trigger trg_payment_case_events_append_only
  before update or delete on public.payment_case_events
  for each row execute function public.payment_case_events_append_only();
revoke all on function public.payment_case_events_append_only() from public, anon, authenticated;
