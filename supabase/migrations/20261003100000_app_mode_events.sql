-- TEST / LIVE mode audit trail (append-only). Written by the server with the
-- service role only; admins can read it. See src/lib/app-mode-log.server.ts.
create table if not exists public.app_mode_events (
  id bigint generated always as identity primary key,
  event text not null check (event in ('mode_observed', 'switch_requested')),
  mode text not null check (mode in ('test', 'live')),
  ok boolean not null,
  user_id uuid references auth.users (id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists app_mode_events_created_idx on public.app_mode_events (created_at desc);

alter table public.app_mode_events enable row level security;
drop policy if exists "Admins read mode events" on public.app_mode_events;
create policy "Admins read mode events" on public.app_mode_events
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));
revoke insert, update, delete, truncate on public.app_mode_events from anon, authenticated;

create or replace function public.app_mode_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Only the FK's ON DELETE SET NULL may touch a row (user_id → null).
  if tg_op = 'UPDATE'
     and new.user_id is null and old.user_id is not null
     and new.id = old.id and new.event = old.event and new.mode = old.mode
     and new.ok = old.ok and new.detail = old.detail and new.created_at = old.created_at
     and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return new;
  end if;
  raise exception 'app_mode_events is append-only';
end $$;
drop trigger if exists app_mode_events_append_only on public.app_mode_events;
create trigger app_mode_events_append_only
  before update or delete on public.app_mode_events
  for each row execute function public.app_mode_events_append_only();

create or replace function public.app_mode_events_truncate_blocked()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'app_mode_events is append-only';
end $$;
drop trigger if exists app_mode_events_no_truncate on public.app_mode_events;
create trigger app_mode_events_no_truncate
  before truncate on public.app_mode_events
  for each statement execute function public.app_mode_events_truncate_blocked();
