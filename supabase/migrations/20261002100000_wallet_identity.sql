-- Wallet-first identity (Phase 3 workstream: identity & KYC).
--
-- A customer signs in with their Solana wallet (Supabase Auth Web3 / Sign in
-- with Solana). Supabase verifies the signature and records the wallet as an
-- auth identity (provider 'web3', provider_id 'web3:solana:<address>'). That
-- identity is written only by Supabase Auth, never by the browser, so it is the
-- trusted source for "this wallet belongs to this LamportPay user".
--
-- This migration mirrors it into public.user_wallets (for the app and admin)
-- and keeps an append-only public.identity_events audit trail:
--   wallet_linked         a wallet was first linked to a user (first sign-in)
--   wallet_authenticated  the wallet signed in again
--   kyc_status_changed    the stored Stables verification status changed
-- A wallet alone never means "KYC verified": verification lives only in
-- stables_customers, written from Stables' own answers.

create table if not exists public.user_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chain text not null check (chain = 'solana'),
  address text not null check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  source text not null default 'web3_sign_in' check (source = 'web3_sign_in'),
  linked_at timestamptz not null default now(),
  last_authenticated_at timestamptz,
  unique (chain, address)
);
create index if not exists user_wallets_user_id_idx on public.user_wallets (user_id);

alter table public.user_wallets enable row level security;
drop policy if exists "Users read own wallets" on public.user_wallets;
create policy "Users read own wallets" on public.user_wallets
  for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'::public.app_role));
revoke insert, update, delete, truncate on public.user_wallets from anon, authenticated;

create table if not exists public.identity_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  event text not null check (event in ('wallet_linked', 'wallet_authenticated', 'kyc_status_changed')),
  wallet_address text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists identity_events_user_idx on public.identity_events (user_id, created_at desc);

alter table public.identity_events enable row level security;
drop policy if exists "Users read own identity events" on public.identity_events;
create policy "Users read own identity events" on public.identity_events
  for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'::public.app_role));
revoke insert, update, delete, truncate on public.identity_events from anon, authenticated;

-- Append-only: nobody (service role included) edits or deletes audit rows.
-- Rows still go when the auth user is deleted (FK cascade runs as a DELETE,
-- so allow deletes only when the user no longer exists).
create or replace function public.identity_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  raise exception 'identity_events is append-only';
end $$;
drop trigger if exists identity_events_append_only on public.identity_events;
create trigger identity_events_append_only
  before update or delete on public.identity_events
  for each row execute function public.identity_events_append_only();

-- Verified timestamp on the Stables customer record (set once, when Stables
-- has approved both the verification and the base payout entitlement).
alter table public.stables_customers add column if not exists verified_at timestamptz;

create or replace function public.stables_customers_identity_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.verification_status = 'approved' and new.base_payout_status = 'approved'
     and new.verified_at is null then
    new.verified_at := now();
  end if;
  if tg_op = 'INSERT'
     or new.verification_status is distinct from old.verification_status
     or new.base_payout_status is distinct from old.base_payout_status then
    insert into public.identity_events (user_id, event, detail)
    values (
      new.user_id,
      'kyc_status_changed',
      jsonb_build_object(
        'from', case when tg_op = 'INSERT' then null else old.verification_status end,
        'to', new.verification_status,
        'base_payout', new.base_payout_status,
        'stables_customer_id', new.stables_customer_id
      )
    );
  end if;
  return new;
end $$;
drop trigger if exists stables_customers_identity_audit on public.stables_customers;
create trigger stables_customers_identity_audit
  before insert or update on public.stables_customers
  for each row execute function public.stables_customers_identity_audit();

-- Mirror Supabase Auth web3 identities. Never blocks a sign-in: any failure
-- here is reported as a warning and the auth write goes ahead.
create or replace function public.sync_web3_wallet()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  addr text;
begin
  if new.provider <> 'web3' or new.provider_id not like 'web3:solana:%' then
    return new;
  end if;
  addr := substr(new.provider_id, length('web3:solana:') + 1);
  begin
    if tg_op = 'INSERT' then
      insert into public.user_wallets (user_id, chain, address, last_authenticated_at)
      values (new.user_id, 'solana', addr, coalesce(new.last_sign_in_at, now()))
      on conflict (chain, address) do nothing;
      insert into public.identity_events (user_id, event, wallet_address)
      values (new.user_id, 'wallet_linked', addr);
    elsif new.last_sign_in_at is distinct from old.last_sign_in_at then
      update public.user_wallets
        set last_authenticated_at = new.last_sign_in_at
        where chain = 'solana' and address = addr and user_id = new.user_id;
      insert into public.identity_events (user_id, event, wallet_address)
      values (new.user_id, 'wallet_authenticated', addr);
    end if;
  exception when others then
    raise warning 'sync_web3_wallet failed for %: %', new.user_id, sqlerrm;
  end;
  return new;
end $$;
revoke execute on function public.sync_web3_wallet() from public, anon, authenticated;
revoke execute on function public.stables_customers_identity_audit() from public, anon, authenticated;

drop trigger if exists on_web3_identity_change on auth.identities;
create trigger on_web3_identity_change
  after insert or update on auth.identities
  for each row execute function public.sync_web3_wallet();

-- Backfill wallets that signed in before this migration.
insert into public.user_wallets (user_id, chain, address, linked_at, last_authenticated_at)
select i.user_id, 'solana', substr(i.provider_id, length('web3:solana:') + 1),
       i.created_at, i.last_sign_in_at
from auth.identities i
where i.provider = 'web3' and i.provider_id like 'web3:solana:%'
on conflict (chain, address) do nothing;

insert into public.identity_events (user_id, event, wallet_address, detail)
select w.user_id, 'wallet_linked', w.address, '{"backfill": true}'::jsonb
from public.user_wallets w
where not exists (
  select 1 from public.identity_events e
  where e.user_id = w.user_id and e.event = 'wallet_linked' and e.wallet_address = w.address
);

-- Existing approved customers: record when we first knew (best available time).
update public.stables_customers
  set verified_at = updated_at
  where verified_at is null and verification_status = 'approved' and base_payout_status = 'approved';
