-- Phase 2 security fix: bind the standalone /swap page's Jupiter relay to the
-- order the server issued, and relay each order at most once.
--
-- POST /api/jupiter/order stores the order Jupiter built for the signed-in user;
-- POST /api/jupiter/execute only relays a transaction that (a) belongs to an
-- order this user was issued, (b) has exactly that order's message, (c) carries
-- a valid signature by the order's taker, and (d) has not been relayed before
-- (conditional ordered -> relayed update). Server-only: users get no access.
-- Non-custodial: the taker is the user's own wallet; nothing here holds funds.

create table public.jupiter_swap_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  taker text not null,
  input_mint text not null,
  output_mint text not null,
  in_amount_minor bigint not null check (in_amount_minor > 0),
  jupiter_request_id text not null unique,
  -- The unsigned transaction the user is asked to sign: only a signed
  -- transaction with exactly this message is relayed.
  order_transaction text not null,
  status text not null default 'ordered' check (status in ('ordered', 'relayed')),
  expires_at timestamptz not null,
  relayed_at timestamptz,
  signature text unique,
  jupiter_status text,
  jupiter_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jupiter_swap_orders_user_idx on public.jupiter_swap_orders (user_id, created_at desc);

alter table public.jupiter_swap_orders enable row level security;
revoke all on public.jupiter_swap_orders from anon;
revoke all on public.jupiter_swap_orders from authenticated;
grant all on public.jupiter_swap_orders to service_role;
