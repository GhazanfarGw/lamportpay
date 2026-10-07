-- Defense in depth (pre-LIVE security review, 7 Oct 2026).
-- RLS already denies these to anonymous callers (every policy is `to authenticated`),
-- but the table grants themselves were broader than needed. Remove them so a future
-- policy mistake cannot expose data to anonymous callers.
revoke all on public.admin_invites, public.app_mode_events, public.identity_events,
  public.user_roles, public.user_wallets from anon;

-- The old demo tables are no longer used by any code path (their admin functions
-- were removed). Nobody but the service role may touch them.
revoke all on public.mock_kyc_submissions, public.mock_payout_transfers from anon, authenticated;
