do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'reviewer', 'user');
  end if;
end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

drop policy if exists "Users can read own roles" on public.user_roles;
create policy "Users can read own roles"
on public.user_roles for select to authenticated
using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

create table if not exists public.mock_kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  full_name text not null,
  email text not null,
  country text not null,
  document_type text not null default 'passport',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.mock_kyc_submissions to authenticated;
grant all on public.mock_kyc_submissions to service_role;

alter table public.mock_kyc_submissions enable row level security;

drop policy if exists "Admins manage mock kyc" on public.mock_kyc_submissions;
create policy "Admins manage mock kyc"
on public.mock_kyc_submissions for all to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create table if not exists public.mock_payout_transfers (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  kyc_submission_id uuid references public.mock_kyc_submissions(id) on delete set null,
  sender_name text not null,
  recipient_name text not null,
  send_amount numeric(18,2) not null,
  send_currency text not null default 'USDC',
  payout_currency text not null,
  payout_amount numeric(18,2) not null,
  fx_rate numeric(18,6) not null,
  total_fee numeric(18,2) not null default 0,
  payment_rail text not null default 'bank_account',
  quote_status text not null default 'draft' check (quote_status in ('draft','active','expired','cancelled')),
  payment_status text not null default 'awaiting_funds' check (payment_status in ('awaiting_funds','processing','paid','failed','refunded')),
  admin_note text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.mock_payout_transfers to authenticated;
grant all on public.mock_payout_transfers to service_role;

alter table public.mock_payout_transfers enable row level security;

drop policy if exists "Admins manage mock transfers" on public.mock_payout_transfers;
create policy "Admins manage mock transfers"
on public.mock_payout_transfers for all to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mock_kyc_touch on public.mock_kyc_submissions;
create trigger trg_mock_kyc_touch before update on public.mock_kyc_submissions
for each row execute function public.touch_updated_at();

drop trigger if exists trg_mock_transfers_touch on public.mock_payout_transfers;
create trigger trg_mock_transfers_touch before update on public.mock_payout_transfers
for each row execute function public.touch_updated_at();

insert into public.mock_kyc_submissions (reference, full_name, email, country, document_type, status)
values
  ('kyc_demo_001', 'Ayesha Khan', 'ayesha.demo@example.com', 'Pakistan', 'passport', 'pending'),
  ('kyc_demo_002', 'Rahul Sharma', 'rahul.demo@example.com', 'India', 'national_id', 'pending'),
  ('kyc_demo_003', 'Chinedu Okafor', 'chinedu.demo@example.com', 'Nigeria', 'drivers_license', 'approved'),
  ('kyc_demo_004', 'Maria Santos', 'maria.demo@example.com', 'Philippines', 'passport', 'rejected')
on conflict (reference) do nothing;

insert into public.mock_payout_transfers (
  reference, kyc_submission_id, sender_name, recipient_name, send_amount, send_currency,
  payout_currency, payout_amount, fx_rate, total_fee, payment_rail, quote_status, payment_status
)
values
  ('pay_demo_1001', (select id from public.mock_kyc_submissions where reference = 'kyc_demo_001'),
   'Demo Sender', 'Ayesha Khan', 500.00, 'USDC', 'PKR', 136610.00, 278.000000, 7.50, 'bank_account', 'active', 'awaiting_funds'),
  ('pay_demo_1002', (select id from public.mock_kyc_submissions where reference = 'kyc_demo_002'),
   'Demo Sender', 'Rahul Sharma', 250.00, 'USDC', 'INR', 20439.00, 83.000000, 3.75, 'upi', 'active', 'processing'),
  ('pay_demo_1003', (select id from public.mock_kyc_submissions where reference = 'kyc_demo_003'),
   'Demo Sender', 'Chinedu Okafor', 1200.00, 'USDC', 'NGN', 1773000.00, 1500.000000, 18.00, 'bank_account', 'active', 'paid'),
  ('pay_demo_1004', null,
   'Demo Sender', 'Maria Santos', 80.00, 'USDC', 'PHP', 4570.00, 58.000000, 1.40, 'mobile_wallet', 'expired', 'failed')
on conflict (reference) do nothing;