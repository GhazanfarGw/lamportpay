# LamportPay: project rules

LamportPay turns stablecoins on Solana into a bank payout, through Stables
(docs.stables.money). Stack: TanStack Start + Vite, Supabase, deployed on Vercel.

The long brief at the top of `README.md` is the original Lovable prompt (Bridge, "demo only",
a fixed corridor list). It is history. Where it conflicts with this file, this file wins.

## Product rules

Change these only on the owner's instruction.

- **Non-custodial, via Stables.** Users send USDC or USDT from their own wallet to the
  single-use deposit address Stables returns for each transfer. LamportPay holds no funds,
  keys or balances; our ledger is a record only. **KYC runs on Stables' hosted page** (resolved
  2026-09-30: the partner model; the earlier "KYC inside LamportPay's UI" wording is withdrawn):
  we store a link and a status, and build no KYC UI of our own.
- **One LamportPay fee (owner decision 2026-09-30, clarified same day).** LamportPay's own fee
  is 2% of the TOTAL the user sends, taken OUT of it (owner decision 2026-09-30, second update:
  user enters 150 → fee 3.00 → 147.00 to Stables → 150.00 leaves the wallet; never 153). All of it
  is LamportPay revenue. Engine: `fee(N) = ceil(N·bps/(10000−bps))` for the net N sent to Stables,
  `splitTotal` for total → net + fee (`src/lib/payments/fee-math.ts`). The /pay UI shows the fee
  amount only, no percentage. It is charged once per
  payment, never a conversion fee plus a swap fee. Provider costs are NOT inside the 2%:
  Stables' fees (shown as "Payout partner fee", from the Stables quote), Jupiter's own swap
  fee/price impact and Solana network fees are separate, paid by the user, shown separately,
  and never deducted from LamportPay's 2%. It is added on top of the Stables quote and paid in the same
  user-signed transaction as a separate transfer to the company revenue wallet (LamportPay's
  own revenue only). Configured by `LAMPORTPAY_FEE_BPS` / `LAMPORTPAY_REVENUE_WALLET` or in
  Admin → Fees & Revenue; `LAMPORTPAY_SWAP_FEE_BPS` must stay 0. Off until the revenue wallet
  is set. **Fee models (C05, 2026-10-01):** the one fee can optionally be kept within a minimum
  and/or maximum (`LAMPORTPAY_FEE_MIN` / `LAMPORTPAY_FEE_MAX`, or admin); a fixed fee is 0% with
  min = max. Both are OFF by default, so the approved plain 2% is unchanged. All fee arithmetic
  lives in `src/lib/payments/fee-math.ts`; each payment records the bounds and the rule applied.
- **Own-account bank payouts only.** The account holder name is locked to the Stables
  customer record (`first_name` / `last_name` from verification) and is not editable. No
  third-party recipients, and no mobile wallet, card or cash payouts.
- **Country picker = `PAYOUT_COUNTRIES`** (server env; default in `src/lib/payout-countries.ts` = the
  sandbox-evidenced list from 2026-09-29; production list OPEN, C36). It only filters the /pay
  picker. The user picks a country; the payout currency is filled in from the
  ISO reference table `src/lib/country-currency.ts` (owner request 2026-10-01; the user can
  change it). That table is not a list of supported corridors: a Stables preview quote decides
  whether a country/currency is supported, and Stables validates the bank fields
  (`POST /payment-methods/validate`). No country-specific business code.
- **Limits: minimum 15 per payment (owner decision 2026-10-07, matching Stables' stated 15 USD minimum; was 100); maximum = Stables' limits (owner decision 2026-09-29).** TEST MODE: 15–5,000 USDC.
  `PAYMENT_MIN_USDC`, `PAYMENT_MAX_USDC`, `PAYMENT_MIN_USDT`, `PAYMENT_MAX_USDT`, read in
  `src/lib/payments/limits.server.ts` (defaults 100 and 1000000; `PAYMENT_MAX_*=none` = no
  LamportPay maximum, Stables' per-customer limits decide). Admins can override them per coin in
  Admin → Settings (C07, `business_settings.payment_limits`, audit logged with a reason).
  Don't repeat the numbers anywhere else.
- **USDC and USDT on Solana only** (`PAYMENT_CURRENCIES` in `src/lib/tokens.ts`, mirrored by
  the `payments_source_currency_check` constraint). **USDC only for now** (owner decision
  2026-09-30): `PAYMENT_ENABLED_CURRENCIES=usdc` or Admin → Settings.
- **White-label UI.** The current UI still names Stables in many places (for example
  `src/routes/_authenticated/pay.tsx`). Ask the owner before adding or removing partner
  branding.

## Product structure

Three separate experiences (see `docs/ROADMAP.md`):
- **Marketing site** (`SiteLayout`): explains LamportPay; its "Convert" button opens the app.
  No admin and no financial functionality in it.
- **App / dApp** (`src/components/app/AppLayout.tsx`): `/pay` (Convert), `/swap`, `/payments`.
  Focused header with wallet and account, no marketing footer. The header's wallet (`AppWalletIsland`)
  is the only connect UI; pages read it via `src/lib/wallet-state.ts`. `/pay` is a wide workspace
  (journey rail | converter | fees & costs) with a
  7-step indicator (Connect → Select → Quote → Review → Sign → Processing → Complete,
  `DappStepper` in `PaymentJourney.tsx`, derived from the server's payment status only).
  "Max" = the largest amount whose total (amount + LamportPay fee) fits the USDC balance
  (`src/lib/payments/fee-math.ts`, same rounding as `fees.server.ts`); balances come from
  `POST /api/wallet/holdings` (server-side Solana read).
- **Admin** (`src/components/admin/AdminShell.tsx`, routes `/admin/*`): its own sidebar
  application. Every server function re-checks the admin role.

## Environments and data

- **Local dev and the dev Supabase project only.** The dev project is `gdksfksypkcfiohozzsx`
  ("LamportPay", the one in `supabase/config.toml`). **Never touch the live database**: the
  original Lovable project `zmcbnknjatrfwrcfvtzt`, or any project other than the dev one.
  Don't read, query, migrate or point `.env` at it.
- **Migrations:** add a file to `supabase/migrations/` and apply it to the dev project only.
- **Stables sandbox only** (`sti_test_` keys, `https://api.sandbox.stables.money`) until the
  owner starts the planned production test.
- **Never print or commit secrets.** Don't cat, echo or log `.env` / `.env.local` values;
  both are gitignored and only the empty `.env.example` is committed. Server-only keys
  (Stables, Supabase service role, Jupiter, `CRON_SECRET`) never go in `VITE_` variables or
  client code.

## Code conventions

- Amounts are integer minor units (`bigint`); convert with `src/lib/money.ts`.
- Every Stables write sends an `Idempotency-Key` (`src/lib/stables/client.server.ts`).
- The Stables transfer state is authoritative; our payment status follows it. The Travel Rule
  is a requirement on the payment (`travel_rule_*` columns), not a payment state.
- Webhooks: Svix-signed only, at `POST /api/public/stables-webhook`. Store, answer 200, then
  process. Unsigned or badly signed requests get 401; 503 only when the secret is not set.
  Missed events are caught up by `/api/cron/reconcile-payments`.

## Commands

```sh
npm run dev        # http://localhost:8080; restart after any .env change
npm test
npm run lint
npm run tunnel     # cloudflared quick tunnel; the URL changes on every start
npm run webhook:send -- <kind> ...   # signed test webhooks (see the runbook)
npm run reconcile  # pull transfer status from Stables, replay stored webhooks
```

- On Windows, if `cloudflared` is not found, add `C:\Program Files (x86)\cloudflared` to
  `PATH` (or open a new terminal after installing it).
- End-to-end sandbox walkthrough: `docs/stables-sandbox-runbook.md`.
- Stables sandbox OpenAPI spec: https://api.sandbox.stables.money/docs/json.

## Phase 3 engineering controls (2026-10-01)

- **Admin audit log is append-only in the database** (C06): UPDATE/DELETE/TRUNCATE refused by
  triggers, `created_at` stamped by the database; only the auth FK may null `actor_id`.
- **CI** (C08): `.github/workflows/ci.yml` runs repo secret check, typecheck, `lint:ci`,
  `test:unit`, build, client-bundle secret scan and `npm audit --audit-level=high`.
  Formatting (`prettier`) is not enforced yet (C32).
- **Dependencies** (C09): `uuid` forced to ^11.1.1 via `overrides`. Remaining moderate
  advisory: `stream-json` under `jayson` (from `@solana/web3.js` v1) — not loaded by the app
  (web3.js uses only `jayson/lib/client/browser`); no upstream fix; forcing v3 breaks jayson.
- **Revenue reconciliation** (C10): Admin → Fees & Revenue → Reconciliation.

## Sign-in (2026-09-30)

- **Admin** signs in at `/admin/login` (own page, admin look). Unauthenticated `/admin/*` redirects there; after sign-in `getAdminSession` checks the role on the server and a non-admin account is signed straight back out. `?next=` only accepts same-site `/admin` paths (`src/lib/admin-path.ts`). Admin sign-out returns to `/admin/login`.
- **Customers** sign in with their wallet (Supabase Auth Web3, Sign in with Solana): one plain-text message signature, never a transaction, key or seed phrase (`src/lib/wallet-sign-in.ts`, bridge in `components/site/wallet/AppWallet.tsx`, triggered via `requestWalletSignIn()` in `lib/wallet-state.ts`). Email + password on `/auth` stays as the fallback.
- Wallet-only accounts have no email. The KYC card asks for it once; `/api/kyc` passes it straight to Stables when the customer is created (`email_required` if missing). LamportPay does not store it.
- 2 Oct: wallet-first identity (see `docs/identity/wallet-first-identity.md`). Connecting a wallet while signed out also asks for the sign-in signature (one step); header shows "Verify wallet" for a restored connection and "Use this wallet" when the connected wallet differs from the account's. Server trusts only Supabase web3 identities (`walletAddressesOf`), never `user_metadata`; `assertLinkedWallet` refuses other wallets for wallet accounts. `user_wallets` / `identity_events` are written by DB triggers only. KYC state: `lib/identity/kyc-state.ts`. `/swap` redirects to `/pay`.
- 2 Oct: payment limits (min/max) apply to the amount the user SENDS (converted + LamportPay fee), in `priceCandidates` (`limitAmountMinor`), `planSettlement`, `liveEstimate`, `quotePayment` and the `/pay` form. Sending exactly the minimum is allowed.
- 1 Oct: TEST / LIVE mode (`docs/security/test-live-mode.md`). Mode = server env `LAMPORTPAY_MODE` (default test). TEST: devnet + devnet test USDC, Stables sandbox, Jupiter read-only quotes only (real mainnet price/fee/impact; order-with-wallet and execute blocked — Jupiter has no devnet), 1–5,000 USDC limit per payment (TEST profile, applied in getBusinessSettings), no real funds. /pay: SOL selectable when the wallet holds SOL; paying in SOL the amount is SOL and Jupiter's ExactIn quote gives the USDC sent. LIVE locked by `src/lib/app-mode-lock.ts` + owner approval env + full production config. Guards live in `app-mode.server.ts` and are called from the Stables client/config, `rpc()`, Jupiter client, funding and swaps. Tests that exercise real-funds logic mock the lock open and use `tests/support/app-mode.ts` LIVE_ENV.
- OWNER ACTION: enable Supabase → Authentication → Sign In / Providers → **Web3 Wallet (Solana)** on the dev project, and make sure new sign-ups are allowed and the Site URL / redirect URLs include the app origin. Until then wallet sign-in shows "not switched on yet; use email".
- 3 Oct: checkout order on `/pay` (owner "NEXT FLOW"): **quote first** (auto-quote, no KYC needed; QUOTED allowed from PAYMENT_CREATED / KYC_PENDING / KYC_APPROVED) → payout details checked with Stables `validatePaymentMethod` (`POST /api/payments/:id/payout-details`; only the bank fields Stables needs per currency, `src/lib/payout-requirements.ts`; CNY not offered) → verification gate (server-decided KYC state; Stables hosted page; only name + email collected) → review → Pay Now. The Stables transfer is still created only for a **verified** customer, and the holder name sent to Stables comes from the verified record.
- 3 Oct: **TEST MODE Pay Now** = the user's wallet signs a real devnet Memo transaction (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, memo `LamportPay TEST payment <id>`, `src/lib/payments/test-payment.ts`) that moves no funds; `POST /api/payments/:id/test-payment` verifies it on devnet (signer, memo, success, freshness, no reuse, one per payment) and then simulates the Stables sandbox deposit. Refused in LIVE MODE.
- 3 Oct: **browser Buffer.** `vite.config.ts` aliases every `buffer` import (web3.js's too) to `src/lib/buffer-polyfill.ts`, which now loads the full `buffer` package via `buffer/index.js` (the old minimal shim broke every transaction serialization: "Buffer.from(...).copy is not a function"). Don't replace it with a Uint8Array shim again. After changing it, start the dev server once with `npm run dev -- --force`.
- Stables sandbox status behaviour (2–3 Oct): NGN and BRL sandbox transfers stay `in_progress` at Stables after the simulated deposit; AUD/GBP ones reached `completed` within a minute (27 Sep). Check what Stables reports with `node scripts/stables-transfer-status.mjs <transfer_id>` (sandbox only, read-only). Details: `docs/stables-sandbox-runbook.md`.
- 3 Oct: Pay Now is one click (the "transfer ready" card continues to the wallet approval via `autoStart`; the wallet still asks the user). Checked payout details are kept per payment in the browser tab only (sessionStorage, cleared when the transfer is created or on Edit) so returning from Stables' verification page does not ask again. Stables failures are logged with Stables' `correlation_id` (what their support asks for); request bodies are never logged.
- 3 Oct (sandbox findings, details in `docs/stables-sandbox-runbook.md`): Stables' sandbox completes GBP transfers but leaves NGN/MXN/KES/BRL in `in_progress`; GBP transfer creation answers 500 unless the amount sent to Stables is a multiple of 20 USDC; the sandbox emits only `transfer.created` webhooks, so DEV needs `npm run reconcile`. Probes: `scripts/stables-sandbox-lifecycle-probe.mjs`, `scripts/stables-transfer-compare.mjs`, `scripts/stables-transfer-status.mjs` (sandbox only; run with `node --use-env-proxy` from the Cowork VM). After the automatic quote, "Check my wallet again" re-reads the balance only (coin and quoted amounts stay). Note: with a production Stables config `quotePayment` still requires the wallet to be ready before a firm quote.
- 3 Oct: **live status sync** (no developer command needed). `getPaymentView` (polled every 5 s by `/pay`, also in background tabs) and the admin payment pages call `syncPaymentWithStables`: for a payment with an open transfer it reads `GET /transfers/{id}` from Stables at most once per `LIVE_SYNC_INTERVAL_MS` (8 s, claimed via `reconciled_at`) and applies the status with the reconciliation rules (forward only; event source `reconcile`, detail `trigger: live_sync`). A Stables error keeps the stored state. Simulated sandbox deposits sync immediately. Webhooks stay the primary path and the cron stays the safety net; `npm run reconcile` is a debugging tool only. The journey rail moves past "Sign" once a payment is detected.

## Pre-LIVE hardening (7 Oct 2026)

- Report + LIVE GO/NO-GO: `docs/production-readiness-2026-10-07.md`. Security checklist: `docs/security/pre-live-security-checklist.md`. Test matrix: `docs/testing/production-readiness-test-matrix.md`. Operations, scheduler, controls, reports: `docs/architecture/operations-and-recovery.md`.
- Refund/compliance/manual review = **operations cases** (`payment_cases`), never payment states. Payment status only mirrors Stables.
- Emergency controls live in `business_settings.payment_controls`, per mode; enforce with `assertPaymentsOpen` in every new payment step; corridor limits via `limitsForCorridor` (can only narrow coin limits).
- Rate limits: `allowShared` (Postgres `rate_limit_hit`); pass a `USER_LIMITS` entry as the 4th argument of `handleUserRequest` for money-moving routes.
- Background reconciliation: Supabase pg_cron job every 5 min calling `/api/cron/reconcile-payments` (Vault secrets `lamportpay_reconcile_url`, `lamportpay_cron_secret`); Vercel daily cron is only a backstop.
- Supabase MCP `execute_sql`/`apply_migration` hang on destructive statements (drop/delete need a confirmation the tool cannot show); apply those by hand.
