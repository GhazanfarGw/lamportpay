# LamportPay execution tracker

**Updated:** 1 October 2026. **The phase structure is the master roadmap** (MASTER_PLAN and
the company Google Sheet, "Roadmap" tab). This file only tracks execution against it; it does
not define phases.

| # | Phase | Status |
|---|---|---|
| 0 | Business and architecture | Done |
| 1 | Web3 MVP foundation | Done |
| 2 | Stables sandbox flow (incl. fees, fee split, fee ledger, audit trail, dApp shell) | Engineering done; owner gate items open (C01–C04) |
| 3 | Revenue engine (pricing snapshot, ledger categories, fee audit, admin pricing screen) | **Current** — C05–C10 implemented (gates 4 and 6 open) |
| 4 | Stables production go-live (controlled) | Planned |
| 5 | Token expansion (Jupiter) | Planned |
| 6 | Compliance operations | Planned |
| 7 | Advanced admin dashboard | Planned (an operational admin foundation exists) |
| 8 | Automation and communication | Planned |
| 9 | Multi-provider fiat | Planned |
| 10 | Security, QA and external audit | Planned |
| 11 | Scaling and public launch | Planned |

Phase gate for every phase: implementation → function testing → security review → technical
audit → documentation → approval.

## Owner decisions in force (30 Sep 2026)
- **LamportPay fee = 2% of what the user sends, taken out of it** (150 sent → 3.00 fee → 147.00 to Stables; update 30 Sep), all of it LamportPay revenue, charged once per payment (conversion
  and any Jupiter swap together; never 2% + 2%). Collected in the user-signed funding
  transaction; no separate swap fee. **Provider fees are separate and extra:** Stables' fees,
  Jupiter's own swap fee/price impact and Solana network fees are paid by the user, shown as
  their own lines, and never taken out of LamportPay's 2%.
- **Payouts only to the verified user's own bank account** (the account holder is the person
  who passed KYC). Earlier notes allowing third-party recipients are withdrawn.
- **USDC only for now**; USDT is switched off.
- **Limits apply to what the user sends** (decision 2 Oct 2026): minimum 100 means sending 100
  is allowed (2.00 fee, 98.00 converted). Previously the minimum applied to the converted amount
  (you had to send 102.05).
- KYC is Stables-hosted. Revenue in USDC to the company hardware wallet (address pending).
- Real-money test and leaked-password protection: handled by the owner.

## Product structure
| Experience | Where | Shell |
|---|---|---|
| Marketing website | `/`, `/how-it-works`, `/workflow`, `/whitepaper`, `/compliance`, `/docs`, `/blog`, `/contact` | `SiteLayout` |
| App (dApp) | `/pay` (conversion, includes any swap), `/payments`; `/swap` redirects to `/pay` | `AppLayout` |
| Admin (operational foundation; full dashboard is Phase 7) | `/admin/*` | `AdminShell` |

## Phase 3 engineering items (1 Oct 2026)
| ID | Item | Status | Evidence |
|---|---|---|---|
| C05 | Configurable fee models (percentage, optional min/max, fixed) | Done (dev) | `fee-math.ts`, migration `20261001120000_fee_models.sql`, `tests/fee-models.unit.test.ts`; default stays plain 2% |
| C06 | Admin audit log append-only in the database | Done (dev DB verified, rolled back) | migrations `20261001130000`, `20261001130100`; `tests/audit-log-append-only.unit.test.ts` |
| C07 | Payment limits editable from admin | Done (dev) | migration `20261001140000`; Admin → Settings; `tests/payment-limits-admin.unit.test.ts` |
| C08 | CI pipeline | Implemented; **not yet run on GitHub** (needs a push, owner-approved) | `.github/workflows/ci.yml`; every step run locally and passed |
| C09 | Dependency maintenance | Done: 15 → 9 moderate, 0 high/critical; residual accepted with reason | `package.json` overrides; `CLAUDE.md` |
| C10 | Revenue reconciliation | Done (dev; no funded fee payments exist yet) | `revenue-reconciliation.ts`, Admin → Fees & Revenue; `tests/revenue-reconciliation.unit.test.ts` |

### Phase 3 workstream: identity & KYC (2 Oct 2026, DEV)
Design: `docs/identity/wallet-first-identity.md`. Manual tests: `docs/testing/manual-sandbox-matrix.md`.

| ID | Item | Status | Evidence |
|---|---|---|---|
| C38 | Wallet-first sign-in (Sign in with Solana; connect + verify in one step; email secondary) | Implemented (dev); **not verified by a person** | `AppWallet.tsx`, `AppLayout.tsx`, `wallet-sign-in.ts` |
| C39 | Wallet ↔ user ↔ Stables customer link, append-only identity audit, `verified_at` | Done (dev DB, migration applied) | `20261002100000_wallet_identity.sql`; append-only checked on dev |
| C40 | KYC state machine; verified customers answered from our record (no repeated Stables lookup) | Done (unit) | `kyc-state.ts`; `tests/wallet-identity.unit.test.ts`, payments-service "wallet-first identity" |
| C41 | Wallet mismatch guard (server 403 `wallet_not_linked`; UI "Sign in with this wallet") | Done (unit) | `service.server.ts` `assertLinkedWallet` |
| C42 | `/swap` folded into `/pay` (in-payment Jupiter swap; `/swap` redirects) | Done (dev) | `routes/swap.tsx`, `AppLayout.tsx` |
| C43 | Wallet action status and rejection messages (sign-in, swap, payment) | Done (dev) | `PaymentWallet.tsx`, `FundingPanel.tsx` |
| C44 | Admin customer identities (wallet, KYC state, Stables customer, verified at, events) | Implemented; **not browser-checked** (needs admin sign-in) | Admin → Users & roles |
| C45 | Manual sandbox test matrix A–M + provider network notes | Documented; owner to run | `docs/testing/manual-sandbox-matrix.md` |
| C48 | TEST MODE / LIVE MODE separation (server-enforced; live locked) | Done (dev, unit + browser) | `docs/security/test-live-mode.md`; `tests/app-mode.unit.test.ts`; migration `20261003100000_app_mode_events.sql` |
| C50 | TEST MODE: Jupiter read-only quotes allowed (swap orders/execution blocked); SOL selectable on `/pay` (SOL amount → Jupiter ExactIn → USDC sent); 1–5,000 USDC TEST limit (server); timeline reaches Quote on a live quote | Done (dev, unit + browser) | `app-mode.server.ts`, `app-mode.ts`, `business-settings.server.ts`, `live-estimate.server.ts`, `pay.tsx`; `tests/app-mode.unit.test.ts` |
| C51 | LIVE: paying in SOL when the wallet also holds enough USDC — the engine still pays in USDC (a swap only covers a shortfall) | Open (engineering + owner decision) | `createPayment` / `planSettlement` have no "pay with SOL" input |
| C52 | Checkout order "quote first" (owner NEXT FLOW, 3 Oct): auto-quote without KYC → payout details → verification gate → review → Pay Now; transfer only for a verified customer | Done (dev, unit + browser) | `state.ts`, `service.server.ts` (`quotePayment`, `createPaymentTransfer`), `pay.tsx` `CheckoutFlow`; matrix N, O, R |
| C53 | Payout details checked with Stables before verification/transfer; only the bank fields Stables needs per currency; CNY not offered | Done (dev, unit + browser NG/GB) | `checkPayoutDetails`, `payout-requirements.ts`, `scripts/stables-bank-fields-probe.mjs`; matrix P |
| C54 | TEST MODE Pay Now: devnet memo transaction (no funds) verified on devnet → sandbox deposit simulated; duplicate/replay/wrong-wallet protection; devnet explorer links | Done (dev, unit + browser, owner-approved signature) | `test-payment.server.ts`, `TestPayPanel.tsx`; matrix U, X |
| C55 | Browser Buffer polyfill was a minimal shim: every in-browser transaction serialization failed (TEST Pay Now, and LIVE funding/swap signing) | Fixed (dev); LIVE paths not exercised | `buffer-polyfill.ts`, `tests/buffer-polyfill.unit.test.ts` |
| C56 | "Payment not found." after the computer slept / went offline (paused query shown as not found) | Fixed (dev, browser) | `pay.tsx` `PaymentPanel`; matrix Z |
| C57 | `package-lock.json` out of sync (`npm ci` failed: utf-8-validate@5.0.10) | Fixed (lockfile only: 7 optional-peer entries added; `npm ci` passes on a clean copy) | `package-lock.json` |
| C58 | Sandbox NGN/BRL/MXN/KES transfers stay `in_progress` at Stables after the simulated deposit; GBP completes (proved end to end: 771ad2e1 COMPLETED 3 Oct); AUD no longer routed | **Blocked by Stables** for those corridors (questions listed in the runbook; owner to send) | `docs/stables-sandbox-runbook.md` "Sandbox transfer status"; `scripts/stables-transfer-status.mjs` |
| C59 | New user completes Stables hosted KYC → verified → Pay Now | Done (dev, owner-run KYC + wallet approval; NG reached IN_PROGRESS) | matrix Q, Y; c7310839 |
| C60 | Pay Now needed two clicks (transfer created, then the wallet was not asked); bank details lost after returning from the KYC page; unclear wallet "Internal error" | Fixed (dev) | `TestPayPanel.tsx` `autoStart`, `pay.tsx` `CheckoutFlow`, `wallet-sign-in.ts`; matrix Y3–Y5 |
| C61 | GBP transfer creation: Stables sandbox 500 unless the amount sent to Stables is a multiple of 20 USDC (proved by direct API probe); Stables errors now logged with their correlation id | **Blocked by Stables** (same as C12 / E2) | matrix Y2; runbook |
| C62 | Monitoring: admin Payments list flags payments waiting too long on Stables (2 h) or on the user's deposit (24 h) | Done (unit); browser check needs admin sign-in | `lib/payments/stuck.ts`, `admin.functions.ts`, `StablesPaymentsAdmin.tsx`; `tests/stuck-payments.unit.test.ts` |
| C63 | Re-check the wallet balance after the automatic quote (coin and amounts stay as quoted) | Done (unit + browser) | `recheckSettlement` balance-only path; `tests/settlement-flow.unit.test.ts` |
| C64 | Pay Now only when the wallet holds the full amount (UI) and, in TEST, the approving wallet's devnet USDC is checked by the server | Done (unit + browser) | `pay.tsx` `CheckoutFlow`, `test-payment.server.ts` |
| C65 | Webhooks in sandbox: Stables' message log shows only `transfer.created` (no `status_transitioned`, even for completed transfers); the dashboard endpoint points at an expired tunnel | Reconciliation required on DEV; production behaviour **needs Stables confirmation** (E1) | runbook "Sandbox transfer status and webhooks" |
| C67 | Payments only progressed after `npm run reconcile` (no status refresh from Stables in the running app); journey rail stayed on "Approve in your wallet" after detection | Fixed (dev): live status sync on every payment view (throttled 8 s), immediate sync after simulated deposits, admin lists poll, rail moves to Processing | `syncPaymentWithStables`; `tests/payments-service.unit.test.ts` "live status sync", `tests/dapp-step.unit.test.ts` |
| C69 | Stables sandbox payout matrix (19 currencies through /pay, admin-simulated deposits, automatic live sync) | Done (dev): GBP/INR/PHP/USD COMPLETED; 14 corridors IN_PROGRESS at Stables; AUD no route; LamportPay matched Stables 18/18 | `docs/testing/stables-sandbox-matrix-2026-10-03.md`; tracker tab "Sandbox Matrix"; Stables Questions P13–P19 |

Open for this workstream: account linking for existing email customers (owner decision),
Stables KYC expiry/refresh semantics and email requirement (Stables), marketing links that still
say "Swap demo" (they now land on `/pay`; copy change is an owner decision).

Owner actions for Phase 3: business decision on actual min/max values (C05 values stay off until
decided), enable branch protection after the first CI run (C08), technical audit and approval.

## Where Phase 2 / Phase 3 stand
See `docs/testing/phase2-status-2026-09-30.md` for the matrix and evidence.

## Provider blockers (Stables)
E1 `transfer.updated.status_transitioned` in sandbox; E2 GBP transfer creation 500s;
`actual_payout` in production; deposit address format and lifetime (the owner's note of "one
address per month" differs from the sandbox's per-transfer address); refunds; Travel Rule;
production corridors; production onboarding (P1–P8 in the sheet).
