-- Travel Rule wallet-ownership verification (Stables webhook
-- travel_rule.wallet_verification_required).
--
-- Additive on top of 20260926150000_payments_fix_round.sql. Not a payment
-- state: the hold runs alongside the Stables transfer state (which may itself
-- be AWAITING_FUNDS_COLLECTION or COMPLIANCE_HOLD), so it is kept as a
-- requirement on the payment instead.

alter table public.payments
  -- Stables' transaction_reference_id for the held transaction.
  add column travel_rule_reference text,
  -- Hosted page where the user proves they own the sending wallet (https only).
  add column travel_rule_verification_url text,
  add column travel_rule_expires_at timestamptz,
  -- Stables' event_created_at of the latest request; older requests are ignored.
  add column travel_rule_requested_at timestamptz,
  -- Set once the transfer moved on (a later non-hold transfer state), i.e. the
  -- hold was lifted. Stables sends no "verified" event.
  add column travel_rule_resolved_at timestamptz,
  add constraint payments_travel_rule_url_https
    check (travel_rule_verification_url is null or travel_rule_verification_url ~ '^https://');

-- Admin: payments still waiting on the user's wallet verification.
create index payments_travel_rule_open_idx on public.payments (travel_rule_requested_at desc)
  where travel_rule_requested_at is not null and travel_rule_resolved_at is null;

-- Admin: Travel Rule requests that matched no payment are only visible in the
-- stored deliveries. Admins may read them; users may not.
grant select on public.stables_webhook_events to authenticated;

create policy "Admins read Stables webhook events" on public.stables_webhook_events
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create index stables_webhook_events_type_idx on public.stables_webhook_events
  (event_type, received_at desc);
