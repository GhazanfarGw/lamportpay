-- Name on the Stables customer record, synced from GET /customers/{id}.
--
-- Payouts go only to a bank account in the customer's own name: Stables
-- requires the account holder name to match its customer record, so the
-- payout form pre-fills and locks this name once verification is approved.
-- Additive on top of 20260926170000_travel_rule.sql.

alter table public.stables_customers
  add column first_name text,
  add column last_name text;
