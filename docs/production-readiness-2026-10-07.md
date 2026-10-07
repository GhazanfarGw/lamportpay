# Pre-LIVE production readiness

Date: 7 Oct 2026 (round 1 audit + round 2 hardening). TEST MODE only (devnet + Stables sandbox).
LIVE MODE locked. Nothing committed, pushed or deployed. Related:
`docs/architecture/operations-and-recovery.md`, `docs/security/pre-live-security-checklist.md`,
`docs/testing/production-readiness-test-matrix.md`,
`docs/architecture/wallet-less-qr-payment-design.md`.

## A. Already working before these rounds

Forward-only state machine mirroring Stables (COMPLETED only from Stables); exact on-chain deposit
verification (amount, mint, Stables address, signer, finalized); unique transfer IDs and funding
signatures; compare-and-set status writes; server-authoritative quotes with expiry; signed,
time-bounded, deduplicated webhooks; live status sync; KYC before payout; TEST/LIVE isolation;
own-row RLS; append-only fee ledger and audit log; daily Vercel cron backstop.

## B. Implemented

### Round 1 (earlier on 7 Oct)

Operations alerts + admin views; operations cases (refund/return workflow, append-only history,
never changes payment status); Recheck Stables; removal of legacy demo-table admin functions;
minimum 15 USDC.

### Round 2 (this round)

| Change                             | WHY                                                       | RISK                                                                          | IMPLEMENTATION                                                                                                                                                                                                               | TEST                                                              | STATUS                                    |
| ---------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| Platform-wide rate limiting        | In-memory limiter only covered public reads, per instance | Low; falls back to per-instance limits if the DB is down                      | Postgres fixed-window counter `rate_limit_hit` (service role only); per-user limits on all payment/KYC routes with stricter buckets for create/quote/transfer/funding/KYC; shared public limits; webhook per-IP + 256 KB cap | `rate-limit-shared.unit` (4); DB function verified on dev         | Done (dev)                                |
| Emergency controls                 | Need to stop payments instantly, per mode, audited        | Medium; mitigated: fail closed on invalid config, never touches sent payments | `business_settings.payment_controls` per mode; `controls.ts`; `assertPaymentsOpen` on create/quote/transfer/funding/TEST Pay Now and the estimate; admin panel; audit + log                                                  | `payment-controls.unit` (7) + 6 service tests                     | Done (dev)                                |
| Per-corridor limits                | Stables limits may differ per corridor (#53)              | Low; can only narrow                                                          | `limitsForCorridor` in settlement, estimate and quote                                                                                                                                                                        | Service test "corridor limit narrows"                             | Done (dev)                                |
| 5-minute background reconciliation | Vercel Hobby cron is daily only                           | Low; inert until configured, idempotent endpoint                              | Supabase pg_cron + pg_net + Vault (`20261007130000_reconcile_scheduler.sql`); per-payment `reconcile_checked` logs; rate-limit pruning                                                                                       | Installed on dev, verified inert without secrets                  | Done (dev); needs secrets per environment |
| Security headers                   | No CSP/frame protection                                   | Low (no script restrictions)                                                  | `src/lib/security-headers.ts` on every response from `src/server.ts`                                                                                                                                                         | `csv-and-headers.unit`                                            | Done (dev)                                |
| Grant hardening                    | Leftover anon grants; demo tables writable by clients     | Low (RLS already denied)                                                      | `20261007140000_privilege_hardening.sql` (applied to dev)                                                                                                                                                                    | Checked table by table on dev                                     | Done (dev)                                |
| Dependency fixes                   | `npm audit` critical/high                                 | Medium (lockfile changed)                                                     | `npm audit fix` (non-breaking)                                                                                                                                                                                               | Full test run; build in clean copy (§F); wallet smoke test MANUAL | Done (dev)                                |
| CSV export + daily report          | Ops reporting                                             | Low (read-only, audited)                                                      | `admin-reports.functions.ts`, `csv.ts`, Reports panel                                                                                                                                                                        | `csv-and-headers.unit`                                            | Done (dev)                                |
| Lint config                        | ESLint crashed on the locked `.vercel` build folder       | None                                                                          | ignore build outputs                                                                                                                                                                                                         | lint:ci                                                           | Done                                      |

Wallet UX, mobile payment UX and the controlled QR implementation were **not** changed this round
(security, integrity and reconciliation came first); see §I.

## C. Needs your decision

1. Enable the 5-minute scheduler on the deployed environment (create the two Vault secrets).
2. Accept or upgrade the remaining dependency findings (`braces`, `stream-json`; §E).
3. Real-money test (Stables #49): amount and corridor.
4. AUD in LIVE (#52). 5. Maximum per payment to agree with Stables (#5).
5. Admin MFA. 7. Notification provider and wording. 8. Reply to Stables on #9 (statement-name
   currencies) and #26 (complaint links).
6. Update the project instructions / MASTER_PLAN to minimum 15.

## D. Needs Stables / legal (tracker tab "Stables Answers", column G)

17 answered by Stables · 3 can be solved internally (done: #46 KYC-first, #53 corridor limits,
#54 polling + scheduler) · 4 need our decision · 12 need Stables (#3, #13, #27–30, #37–39, #48,
#51, #55) · 19 need legal/compliance (#14, #17, #20, #23–25, #31–36, #40–45, #47).

## E. Security

See the checklist. Fixed this round: rate limiting, security headers, webhook abuse limits, grant
hardening, critical npm finding. Still open: leaked-password protection (owner action in the
Supabase dashboard — FAIL), remaining `npm audit` items (13 high/9 moderate, no non-breaking fix),
admin MFA, full CSP trial, idempotency key on payment creation, independent security review.

## F. Test results (round 2)

- Typecheck clean; lint 0 errors (10 existing warnings).
- Tests: 508 passed, 21 skipped, 2 failed (`solana-rpc.test.ts` live testnet/mainnet connectivity;
  network, unrelated).
- `npm ci` (831 packages) and production build: **PASS** in a clean copy on drive C: (drive E:
  refuses access to build output folders). The build output contains the Vercel cron
  (`/api/cron/reconcile-payments`, `0 5 * * *`).
- Secret scan of changed files: clean (only existing test fixtures named `sti_live_…`).

## G. Remaining risks

Stables' manual refund process (no SLA); 14 corridors unproven until real money; production
webhooks unconfirmed; `actual_payout` unconfirmed; integrator fee unavailable; dependency
findings; drive E: file-system errors on the development machine.

## H. LIVE GO / NO-GO checklist

| #   | Gate                                                                                      | Owner           | Status |
| --- | ----------------------------------------------------------------------------------------- | --------------- | ------ |
| 1   | Security FAIL items closed (leaked-password protection)                                   | Owner           | NO-GO  |
| 2   | Dependency findings accepted or fixed, with wallet smoke test                             | Owner + Eng     | NO-GO  |
| 3   | Independent security review of payment, webhook and admin paths                           | Owner           | NO-GO  |
| 4   | 5-minute reconciliation enabled and observed on the deployed environment                  | Eng             | NO-GO  |
| 5   | Production Stables onboarding (KYB, production key, IP allowlist, checklist #11)          | Owner + Stables | NO-GO  |
| 6   | Production webhook endpoint registered and verified (#54)                                 | Eng + Stables   | NO-GO  |
| 7   | Controlled real-money end-to-end test reconciled (project rule 14)                        | Owner           | NO-GO  |
| 8   | Legal: terms/privacy, entities/licences (#31–36), MSA (#47), customer protection (#23–25) | Legal           | NO-GO  |
| 9   | LIVE limits, fee, revenue wallet, corridors confirmed in LIVE controls                    | Owner           | NO-GO  |
| 10  | Manual UI pass (mobile + desktop, wallet connect/reject, admin screens)                   | Eng             | NO-GO  |
| 11  | Operations runbook (refund cases, pause, recheck) agreed with Stables ops                 | Owner           | NO-GO  |
| 12  | Commit, review and deploy to a staging environment                                        | Owner approval  | NO-GO  |

**Overall: NO-GO for LIVE.** Engineering readiness improved (score 58/100, up from 50), but
gates 1–12 are open and several need the owner, Stables or legal.

## I. Recommended next round

Wallet UX and mobile payment UX pass with screenshots; manual test matrix items; idempotency key on
payment creation; CSP report-only trial; admin MFA; notifications outbox (after the provider
decision); QR flow only after the Stables answers in its design doc.

## J. LIVE readiness score: 58 / 100

| Area                  | Weight | Score | Change                                                   |
| --------------------- | ------ | ----- | -------------------------------------------------------- |
| Payment core          | 25     | 23    | +1 (corridor limits, pause enforcement)                  |
| Operations            | 15     | 13    | +2 (scheduler, controls, reports)                        |
| Security              | 20     | 15    | +4 (rate limiting, headers, grants, critical dependency) |
| Provider confirmation | 15     | 6     | +1 (#49, #50, #52 answered)                              |
| Legal / compliance    | 10     | 1     | —                                                        |
| Real-money validation | 15     | 0     | —                                                        |
