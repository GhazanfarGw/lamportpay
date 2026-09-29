# Phase 2 verification pass — 2026-09-29

Scope: live connectivity, non-custodial flow, payment states, Jupiter, Stables, fees/limits,
security, test suite, docs. **Phase 2 is not approved.** Nothing committed. Test payments untouched.

## Live connectivity

- From the development PC (Windows), Stables sandbox, Jupiter and Supabase answered HTTP
  (plain reachability check, no API call).
- The live sandbox smoke test (auth, transfer creation, transfer status, webhook/reconcile) was
  **not run**: the dev server could not stay up on the PC (Node crashes with out-of-memory /
  `0xC0000409`; free commit memory was ~330–650 MB). **NOT VERIFIED in this pass.**
- Most recent live evidence stays the 2026-09-27/28 runs in `docs/stables-sandbox-runbook.md`.

## Test suite (Vitest 4.1.11, Node 24.19, heap capped at 1 GB)

| | Count |
|---|---|
| Test files | 15 (10 passed, 5 failed) |
| Tests | 331 total: **288 passed**, **22 failed**, **21 skipped** |

- All 22 failures are the same error: `fetch failed … ECONNREFUSED 127.0.0.1:8080`. These are
  the end-to-end files (`integration-status`, `payments`, `jupiter-quote`,
  `jupiter-order-execute`, `solana-rpc`) that need `npm run dev` running. Environment, not a
  code result. **NOT VERIFIED** until re-run with the dev server up.
- 21 skipped: signed-in Jupiter E2E tests (`E2E_ACCESS_TOKEN` not set).
- Known `.env` item: the `solana-rpc` testnet case expects a custom Alchemy endpoint
  (`SOLANA_TESTNET_RPC_URL`), which `.env` does not set. That is configuration, not an app defect.
- Typecheck, lint, production build: **not completed** in this pass (see the report for why).

## Review findings (reported, not changed)

1. **FIXED (approved 2026-09-29, see below).** `POST /api/jupiter/execute` (the standalone `/swap` page) relayed any user-signed transaction
   with any `requestId`: it is not bound to an order the server issued, has no replay guard, and
   the `taker` in `/api/jupiter/order` is not tied to the user's wallet. The payment-bound swap
   path (`/api/payments/:id/swaps/*`) does all of this correctly. Also no fetch timeout on the
   three standalone `/api/jupiter/*` routes.
2. No application-level rate limiting on API routes.
3. Homepage demo components (`TransferSimulator`, `VerifiedUsers`, `LiveRates`,
   `LiveSwapTheater`, `WorldPulse`, `demo-data.ts`) use hard-coded prices, a 0.5% demo fee,
   and list "Mobile wallet / Card / Cash pickup" payouts. They are labelled demo and are not
   imported by money code (enforced by `no-mock-imports.unit.test.ts`), but they conflict with
   the bank-only rule and the "no fake statistics" UI principle.
4. No LamportPay fee configuration exists in the payment path; the receipt reads the fee from
   Stables' `integrator_fee` line. Pending Stables' answer on `integrator_fee`.
5. `CLAUDE.md` says KYC runs on Stables' hosted page with no KYC UI of our own; the project's
   white-label decision says every step, including KYC, stays inside LamportPay's UI. Needs one
   owner decision so the docs agree.
6. `docs/MASTER_PLAN.md` is not in the repository (the master plan is a Google Doc).

## Open with Stables

See `docs/stables-sandbox-runbook.md` → open questions, plus `transfer.updated.status_transitioned`
in production (P2/E1 stays OPEN), `integrator_fee` settlement, `actual_payout`, deposit
address format/expiry, refunds of wrong-amount deposits.

Real-money test: `docs/testing/real-money-test-plan.md` (plan only).

## Fix: standalone Jupiter relay (approved by the owner, 2026-09-29)

- `POST /api/jupiter/order` now builds the order through `getOrder` (timeout, response
  validation, taker must be a signer) and stores it in `jupiter_swap_orders` for the signed-in
  user, valid for 2 minutes.
- `POST /api/jupiter/execute` relays only a transaction for an order this user was issued, with
  exactly that order's message and a valid signature by its taker, before expiry, and only once:
  a conditional `ordered → relayed` update is the replay guard. An unknown outcome (timeout)
  leaves the order `relayed`, so it is never sent again. Unknown and other users' request IDs get
  the same 404.
- `POST /api/jupiter/quote` has a 15 s timeout.
- Code: `src/lib/jupiter/swap-orders.server.ts`; migration
  `supabase/migrations/20260929120000_jupiter_swap_orders.sql` (server-only table, RLS on, no
  user grants); tests `tests/jupiter-swap-orders.unit.test.ts` (12 tests).
- **The migration is not applied to the dev Supabase project yet** (the apply was refused by a
  permission check in this session). Until it is applied, `/swap` orders fail with 503.

Results after the fix (Windows, Node 24.19):

| Check | Result |
|---|---|
| Unit + E2E suite | 343 tests: **300 passed**, 22 failed (all `ECONNREFUSED :8080`, dev server not running), 21 skipped |
| New relay tests | 12/12 passed |
| Typecheck (`tsc --noEmit`) | **Passed**, no errors |
| Lint (`eslint src tests scripts`) | **Failed on formatting only**: 1,036 `prettier/prettier` errors in 42 files, all pre-existing and auto-fixable, 0 other rule errors, 7 warnings. The new files are clean. |
| Production build | **Not completed**: `EPERM unlink .vercel/output/static/assets/…` (a file there is locked on the PC). Build-output secret scan therefore not done. |

## Follow-up run, 2026-09-29 (after the owner's review request)

Migration `20260929120000_jupiter_swap_orders.sql`: reviewed (see below; applied later the same day, dev only). Additive, server-only table; RLS on with no policies; `anon` / `authenticated` have
no grants; only `service_role` (the server) reads/writes. Stores user id, public wallet address,
the unsigned order transaction, public signature and Jupiter's status. No keys, no funds.
Rollback: `drop table public.jupiter_swap_orders;` (touches nothing else).

Environment findings:
- `E:` is **exFAT**. Node's `readlink` there returns `EISDIR`, which breaks Nitro's externals
  step, so `vite build` fails on `E:\lamportpay` (not a code defect). The same tree copied to an
  NTFS folder (`C:\lp-buildcheck`, no `.git`) builds cleanly and runs `npm run dev` stably.
- The earlier `.vercel/output` lock was a leftover `eslint .` process from this session; it was
  stopped and the lock cleared without deleting anything by hand.

| Check | Result |
|---|---|
| Full suite with dev server up (NTFS copy) | 343 tests: **321 passed**, **1 failed**, 21 skipped |
| The 1 failure | `solana-rpc` testnet: expects a custom endpoint; `SOLANA_TESTNET_RPC_URL` is not set in `.env` (configuration) |
| Skipped | 21 signed-in tests (`E2E_ACCESS_TOKEN` not set) |
| Typecheck | Passed |
| Lint (new/changed Jupiter files, tests) | 0 errors, 0 warnings |
| Lint (`types.ts`, generated style) | 475 prettier errors at HEAD → 619 now; all `prettier/prettier`, from generated-style additions (Phase 2 tables incl. `jupiter_swap_orders`) |
| Production build (vercel preset, NTFS copy) | **Passed** (183 files, 80 static) |
| Secret scan of build output | Server secrets (service role, Stables key, webhook secret, Jupiter key, cron secret, RPC URLs) found **0** times; client bundle holds only the publishable Supabase URL/key/project id |

Live sandbox (read-only, 2026-09-29 ~07:00 PKT): Stables `GET /customers` 200 (bad key 401);
transfers `50c05d8f…`, `3dbeb6c1…`, `75292f42…` are `completed` at Stables (no `actual_payout`),
while our records stay `CREATED` (preserved; reconcile deliberately not run). Jupiter read-only
order 200. No transfer was created and no money moved.

## Owner decisions applied, 2026-09-29

- **Migration applied to the DEV project only** (`gdksfksypkcfiohozzsx`), same SQL as the repo
  file. Verified: table exists; RLS on, 0 policies; `anon` / `authenticated` have no
  select/insert/update/delete; `service_role` has all; indexes: pkey, `jupiter_request_id` key,
  `signature` key, `jupiter_swap_orders_user_idx`. Through the REST API: service role select 200,
  anon select/insert 401 (42501). Production untouched.
- **Build/test location:** `C:\lamportpay-build` (NTFS) is a mirror of `E:\lamportpay` made with
  `robocopy /MIR`, **without** `.git` or any `.env` file. Commands run with
  `node --env-file=E:\lamportpay\.env …`, so secrets stay only in the real project. `E:\lamportpay`
  stays the working repository and source of truth; re-sync the mirror before each run.
- `C:\lp-buildcheck` was checked (no unique code: only a temporary `types_head.ts` lint artifact)
  and deleted, including its copied `.env`.
- **Preserved test evidence:** payments `93e94178…` (transfer `75292f42…`), `b6601115…` (`3dbeb6c1…`)
  and `8f05eb6e…` (`50c05d8f…`) stay `CREATED`, `reconciled_at` null, while Stables reports
  `completed`. Dry run (read-only, nothing written): `normalizeTransferStatus("completed")` =
  `COMPLETED` and `checkTransition(CREATED → COMPLETED)` = allowed, so reconciliation *would*
  advance them in one step. Kept as an open reconciliation test case; not run.
- **Lint scope:** changed Jupiter files and new tests are clean; the remaining `prettier/prettier`
  errors are a separate formatting-cleanup task (not run).
- Full suite (mirror, dev server up, after migration): 343 tests, 321 passed, 1 failed
  (`SOLANA_TESTNET_RPC_URL` not set), 21 skipped (`E2E_ACCESS_TOKEN` not set).
- Supabase security advisor (dev): INFO `jupiter_swap_orders` has RLS with no policies (intended:
  server-only); WARN `public.has_role(uuid, app_role)` is SECURITY DEFINER and callable by any
  signed-in user (pre-existing; lets a user ask whether any user id has a role); WARN leaked-password
  protection disabled in Supabase Auth (pre-existing).

## Final pass, 2026-09-29

- **`has_role` information leak — confirmed on dev, fix written, NOT applied.** As a signed-in
  non-admin, `select public.has_role('<another user>', 'admin')` returned `true`. Fix:
  `supabase/migrations/20260929130000_has_role_self_only.sql` (same signature, still SECURITY
  DEFINER, answers only for the caller's own id or the service role; RLS policies and app code
  unchanged because they all pass `auth.uid()`). Applying it to dev was refused by a permission
  check in this session; the owner applies it (Supabase SQL editor or approval).
- **Solana testnet test corrected** (`tests/solana-rpc.test.ts`): the app correctly falls back to
  the public testnet endpoint when `SOLANA_TESTNET_RPC_URL` is unset (Alchemy has no Solana
  testnet); the test now checks that behaviour instead of demanding Alchemy. Devnet and mainnet
  still require the Alchemy endpoint.
- Full suite (NTFS mirror, dev server up): **343 tests, 322 passed, 0 failed, 21 skipped**
  (signed-in tests; no `E2E_ACCESS_TOKEN`).
- Typecheck: passed. Lint on all changed/new files: 0 errors, 0 warnings.
- Production build (vercel preset, NTFS mirror): passed. Secret scan of `.vercel/output`
  (183 files): 0 hits for every server secret and for key/secret patterns.
- Still open, outside code: Stables confirmations (E1 webhook, `integrator_fee`, `actual_payout`,
  deposit address, refunds, Travel Rule); signed-in E2E + live transfer creation (need a dev test
  user token); leaked-password protection toggle in Supabase Auth settings; real-money test
  (owner-started); formatting cleanup (separate task).

## Closing pass, 2026-09-29 (owner: "hold Stables questions, finish the rest")

- **`has_role` fix APPLIED to dev** (owner-approved). Verified as `authenticated`: another
  user's admin role now reads `false` (was `true`); the caller's own admin role still reads
  `true`. The Supabase advisor still lists the generic "SECURITY DEFINER callable by
  authenticated" warning: the function must stay callable (RLS policies use it), but it no longer
  answers for other users.
- **Signed-in E2E:** dev-only test user `e2e-phase2@lamportpay.test` created with the service role
  (random password, not stored; reset it with the service role to re-run). Token obtained by
  normal sign-in and passed to the test run only.
  **Full suite: 343 tests, 343 passed, 0 failed, 0 skipped** (NTFS mirror, dev server up).
  The signed-in Jupiter order test got Jupiter's refusal for the empty test wallet (no order
  stored, `jupiter_swap_orders` still has 0 rows); the relay path is covered by the 12 unit tests.
- **Leaked-password protection: NOT enabled.** The toggle is Pro-plan only; this org is on the
  Free plan, and the dashboard did not keep the change. Needs a plan upgrade (owner decision).
- **Stables webhook (E1, on hold with Stables):** the Stables docs say
  `transfer.updated.status_transitioned` is "emitted whenever a transfer's status changes".
  This tenant has no API-managed subscriptions (`GET /api/v1/webhooks` = 0), so delivery depends
  on the dashboard endpoint's selected event types. The dashboard needs the owner's login
  (password + CAPTCHA), so the selection could not be checked here. Check: Settings → Webhooks →
  endpoint → events include `transfer.updated.status_transitioned` (or `all`).
- Live transfer creation was last verified on 2026-09-27 (three sandbox transfers created and
  completed at Stables). Re-running it needs a KYC-approved sandbox customer; the new E2E user
  has no Stables KYC.
- The 3 preserved `CREATED` payments are unchanged.

## Stables dashboard check (owner logged in), 2026-09-29

- Settings → Webhooks has one endpoint: an old cloudflared quick-tunnel URL
  (`hint-administered-wit-instruments.trycloudflare.com/api/public/stables-webhook`), error rate
  83.4%. Quick-tunnel URLs change on every restart, so deliveries fail whenever the tunnel is down.
  For production the endpoint must be the deployed app's fixed URL.
- Message logs: real events (UUID message ids) include `transfer.created`,
  `kyc_link.updated.status_transitioned` and a new type `entitlement.requested` (stored and
  acknowledged by our handler as an unknown type). Every `transfer.updated.status_transitioned` in
  the log has a `msg_…` id, i.e. dashboard test sends. **No real `transfer.updated.status_transitioned`
  was sent by the sandbox**, confirming the finding. Held with Stables by owner decision (E1 OPEN).

## Live webhook re-test with a fresh tunnel, 2026-09-29 08:00–08:08 PKT

- New quick tunnel `founded-told-symbols-lightbox.trycloudflare.com`; the owner updated the
  existing dashboard endpoint's URL (same signing secret). Subscribed events include
  `transfer.updated.status_transitioned`.
- Dashboard "Send Example" deliveries (customer.updated, kyc_link…, travel_rule…,
  transfer.updated…) all succeeded end to end and were stored/verified by our endpoint (the
  transfer.updated example reuses an event_id already stored on 2026-09-27, so it was answered
  as a duplicate, as designed).
- **Real sandbox transfer** `9618a0af-cc6c-40cc-abda-850533589e73` (customer `795876e6…`,
  110 USDC → 104.72 USD, created directly via the Stables API for this check; not linked to any
  LamportPay payment). USDC→AUD had no route and USDC→GBP creation returned 500 at the time.
  Deposit simulated at 03:07 UTC; Stables moved it `created → in_progress → completed` within
  ~10 s.
- **Result:** Stables delivered `transfer.created` (03:06:40 UTC, received and stored by us) but
  **no `transfer.updated.status_transitioned`** for either status change; the dashboard message log
  shows none either. Delivery path is proven working, so this is Stables sandbox behaviour.
  E1 stays OPEN (held with Stables by owner decision).

## Final Phase 2 changes, 2026-09-29 (owner-directed)

- **Bank payout estimate:** `/pay` shows "Usually reaches your bank within about 1 hour" while
  the payout is in flight (FUNDS_COLLECTED → PAYMENT_PROCESSED). From `PAYOUT_ESTIMATE_MINUTES`
  (default 60, per the payout partner). Display only; no new or changed payment states. Actual
  step times stay in the timeline.
- **Marketing site:** stays a static marketing site with demo content (owner decision), but
  countries the partner does not support were removed: Bangladesh, Egypt, Peru, India
  (and Jakarta/Indonesia from the cities strip). Basis: live Stables sandbox preview quotes on
  2026-09-29 (BDT/EGP/SAR invalid; PEN, INR, IDR not routed). Kept: Pakistan (contract), Nigeria,
  Philippines, Mexico, Colombia, Brazil, Kenya, UK, US. The sandbox is flaky (500s), so the
  production corridor list must be confirmed with Stables. Payout methods on the marketing site
  reduced to bank only (business rule).
- **Stables docs check:** Travel Rule, refunds and payout timing are not documented publicly.
  The app already follows Stables' `travel_rule.wallet_verification_required`, `COMPLIANCE_HOLD`
  and `FAILED` / `CANCELLED`; no parallel compliance or refund flow was added.
- **Results:** typecheck passed; 343/343 tests passed (signed-in E2E included); lint on changed
  files: no new errors (3 pre-existing formatting errors in `whitepaper.tsx`); production build
  passed; secret scan 0 hits.
- Revenue model decided for Phase 3: see `docs/phase3-plan.md`.
