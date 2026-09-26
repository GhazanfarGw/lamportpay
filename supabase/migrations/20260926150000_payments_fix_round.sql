-- Phase 2 fix round: settled payout, declared payer wallet, reconciliation.
--
-- Additive on top of 20260926120000_stables_payments.sql.

alter table public.payments
  -- Final settled amount Stables reports once the transfer completes
  -- (TransferResponse.actual_payout), in minor units of its currency.
  add column actual_payout_minor bigint,
  add column actual_payout_currency text,
  -- The wallet the user said they would pay from (connected wallet, or declared
  -- when verifying a manual send). Funding must come from this wallet.
  add column payer_wallet text,
  -- Last time the reconciliation job compared this payment with Stables.
  add column reconciled_at timestamptz,
  add constraint payments_destination_currency_format
    check (destination_currency ~ '^[a-z]{3}$'),
  add constraint payments_actual_payout_complete
    check ((actual_payout_minor is null) = (actual_payout_currency is null));

-- Reconciliation picks active transfers, least recently checked first.
create index payments_reconcile_idx on public.payments (reconciled_at nulls first)
  where transfer_id is not null;

-- The reconciliation job writes timeline rows too.
alter table public.payment_events drop constraint payment_events_source_check;
alter table public.payment_events add constraint payment_events_source_check
  check (source in ('api', 'webhook', 'reconcile'));

-- Stored deliveries not yet processed, oldest first (retried by reconciliation).
create index stables_webhook_events_unprocessed_idx on public.stables_webhook_events (received_at)
  where processed_at is null;
