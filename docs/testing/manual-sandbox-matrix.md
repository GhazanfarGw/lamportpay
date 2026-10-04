# Manual test matrix: wallet, KYC, swap, Stables sandbox

For the owner's manual testing on DEV. Written 2 Oct 2026. Nothing here is marked verified until
a person runs it and records the result.

## Environments (what each provider really offers)

| Layer | What DEV uses | Notes |
|---|---|---|
| App | `http://localhost:8080` (`npm run dev`) | |
| Database / Auth | Supabase **dev** project `gdksfksypkcfiohozzsx` | Web3 Wallet (Solana) provider enabled by the owner on 30 Sep |
| Stables | **Sandbox** (`https://api.sandbox.stables.money`, `sti_test_` key) | Config refuses a sandbox key with a production URL. System status shows "Stables sandbox". |
| Solana | **devnet** in TEST MODE (since 1 Oct; `docs/security/test-live-mode.md`) | Balances are devnet balances (devnet SOL + Circle devnet USDC); the sign-in message signature costs nothing |
| Jupiter | Mainnet swap API (`api.jup.ag/swap/v2`) | The code uses mainnet only; we do not assume a Jupiter devnet. **A swap is a real on-chain swap with real SOL, even when Stables is in sandbox.** In TEST MODE only read-only price quotes are made (since 3 Oct); a swap is never built or executed, so swap scenarios need LIVE MODE. |
| Stables deposit | Sandbox gives placeholder deposit references, not real addresses | TEST MODE Pay Now (3 Oct): the wallet signs a devnet memo transaction that moves no funds; the server verifies it on devnet and simulates the sandbox deposit. Admin → Payments "Simulate deposit" still exists. |

So there is no single "all-testnet" path. The reproducible DEV path is: real wallet sign-in
(free), real balance reads (free), Stables sandbox for quote/KYC/transfer, simulated deposit.
A Jupiter swap (scenario E) spends real SOL and needs the owner's explicit go-ahead with a tiny
amount; it lands USDC in the owner's own wallet (non-custodial).

Tip: do not use the company revenue wallet as a customer test wallet.

## Scenarios

| # | Scenario | Steps | Expected | Evidence to record |
|---|---|---|---|---|
| A | New wallet | Signed out → Connect wallet → pick wallet → approve message | One message popup (no fee, no transaction). Signed in. `user_wallets` row + `wallet_linked` event. KYC card: "not verified yet", asks names (+ email once). Verify with Stables → hosted page. Sandbox approval arrives by webhook → `kyc_status_changed` event, `verified_at` set. | Screenshot of popup text; Admin → Users → Customer identities row |
| B | Returning verified wallet | Sign out → connect same wallet → approve message | Recognised as the same user. KYC shows Verified with no email/password and no new KYC. `/api/kyc` makes no Stables call (server log). `wallet_authenticated` event. | Admin identity events |
| C | Returning wallet, KYC incomplete | Wallet whose customer is `in_progress`/`requires_action` | Correct state shown; only "Continue verification" offered | Screenshot |
| D | Wallet with USDC | Signed in, enough USDC → amount + country → Get live quote → bank details → Review | Fees box: LamportPay fee inside the amount, Stables parts from the live quote. Sandbox: deposit simulated by admin; status timeline follows Stables. | Payment ID, Stables transfer ID |
| E | Not enough USDC, has SOL | As D with SOL only | Payment offers "Swap for the missing X USDC" inside `/pay`; review shows SOL in / min USDC out; wallet approval; "Swap completed … Preparing your payment."; payment continues. **Real SOL.** | Swap signature on Solana explorer |
| F | Reject the Jupiter swap | In E, reject in the wallet | "Transaction rejected. No funds were moved." Payment not marked successful; can retry the same order | Screenshot |
| G | Reject the payment transaction | Only with live funding (not in sandbox) | Same message; payment stays unfunded | — (production only) |
| H | Quote failure | Unsupported country or Stables down | Clear error; retry does not create duplicates | Error text |
| I | KYC pending / rejected | Sandbox customer rejected | "Verification rejected"; payment creation refused (403 `kyc_rejected`); never shown as verified | Screenshot |
| J | Same wallet, another browser/device | New browser → connect → sign | Same account and KYC state (identity is the wallet, not local storage) | Screenshot |
| K | Wallet changed | Signed in with wallet 1, switch extension to wallet 2 | Header "Use this wallet"; `/pay` button "Sign in with this wallet to continue". Server refuses wallet 2 for wallet 1's account (403 `wallet_not_linked`). Wallet 2 becomes its own account with its own KYC. | Screenshot + network response |
| L | Provider unavailable | Stables unreachable during an open verification | KYC card: "could not be reached … last known status"; never upgraded | Screenshot |
| M | Duplicate requests | Double-click Get live quote / swap / send | One payment, one swap order, one relay, one fee | DB rows |

## Automated coverage (unit)

`tests/wallet-identity.unit.test.ts` (identity parsing, wallet link, KYC states, rejection
messages), `tests/payments-service.unit.test.ts` → "wallet-first identity" (mismatch guard,
no Stables call for verified customers, provider unavailable), `tests/auth-entry.unit.test.ts`
(admin redirect, sign-in messages), existing swap/relay idempotency tests.


## TESTNET checkout flow (owner "NEXT FLOW", 3 Oct 2026) — results

Run on DEV (TEST MODE, devnet, Stables sandbox) by Claude in the browser, with the owner approving
wallet signatures. "Passed" means seen in the browser and confirmed in the dev database or Stables.

| # | Scenario | Result | Evidence |
|---|---|---|---|
| N | Quote before verification (verified user) | Passed | fe62b23e (NG, 10 USDC): auto-quote → QUOTED; quote refresh |
| O | Quote before verification (user with no Stables customer) | Passed | 1ac88bef (GB, 20 USDC), wallet BUGA…m4dM: QUOTED with no KYC |
| P | Payout details checked by Stables (only fields Stables needs) | Passed | NG: bank, NUBAN, phone; GB: bank, account, sort code, address. Event `payout_details_checked`, masked account |
| Q | New user: Stables customer + hosted verification link | Passed | `stables_customers` row `in_progress`, Sumsub sandbox link; gate shows "Verify your details" |
| R | Pay Now locked until verified (UI and server) | Passed | No Pay Now button; direct API: transfer 409 `kyc_required`, test-payment 409 |
| S | Another user's payment | Passed | `GET /api/payments/<other user's id>` → 404 |
| T | Returning verified user | Passed | "Verification complete", no new KYC, verified name locked |
| U | TEST Pay Now: wallet approval → devnet tx detected → sandbox deposit simulated | Passed | fe62b23e: tx 4XfzLdbf… (devnet), events `test_payment_detected`, `sandbox_deposit_simulated` |
| V | Status follows Stables (reconcile) | Passed to IN_PROGRESS | CREATED → IN_PROGRESS (source reconcile) |
| W | COMPLETED | Passed (GBP, 100 USDC to Stables); NGN/MXN/KES/BRL blocked by Stables sandbox | 771ad2e1: CREATED → COMPLETED (reconcile), `/pay` "Completed — paid into your account". NGN/MXN/KES/BRL stay `in_progress` at Stables (runbook, "Sandbox transfer status") |
| X | Explorer links on the correct network | Passed | "View transaction" / timeline links use `?cluster=devnet` |
| Y | New user completes hosted KYC → verified → Pay Now | Passed (owner did the hosted KYC and wallet approval) | Account BUGA…m4dM: `stables_customers` approved 2 Oct 23:44 UTC; c7310839 (NG, 10 USDC): transfer created, devnet tx 3hXGNtxK… detected, sandbox deposit simulated → IN_PROGRESS |
| Y2 | Same new user, GBP corridor at 20 / 103 USDC | Failed at Stables (amount not a multiple of 20; see runbook) | 1ac88bef (GB, 20 USDC): `POST /transfer` → Stables **500** "Something went wrong while creating the transfer" (correlation id `fce3764e-42e7-4ad5-8db9-d66ccd9be722`), reproduced twice; shown to the user as "The payout partner is unavailable". Same as tracker C12 (E2) |
| Y3 | One Pay Now click | Fixed 3 Oct | Before: the first click created the transfer, then the screen changed and the wallet was never asked. Now the "transfer ready" card continues to the wallet approval automatically (still requires the user's approval) |
| Y4 | Bank details kept after returning from Stables' verification page | Fixed 3 Oct | Checked details kept for that payment in that browser tab only (sessionStorage), cleared when the transfer is created or on Edit |
| Y5 | Wallet "Internal error" on send | Observed once, retry succeeded | Clear message now ("Your wallet reported an internal error… a payment is never counted twice") |
| Z | Reload after the computer slept / offline | Passed (fixed 3 Oct) | Shows "Waiting for your connection…", never "Payment not found." |
| Y6 | Pay Now only when the wallet holds the full amount | Passed (unit + browser) | UI: Pay Now disabled with "In TEST MODE swaps can't run…" when the settlement isn't `funds_ready`; server: TEST payment refused with 409 `insufficient_funds` if the approving wallet's devnet USDC < total |
| Y7 | Re-check the wallet after the automatic quote (top-up) | Passed (unit + browser) | 03dbff6f: 70 → 120 devnet USDC, "Check my wallet again" → "Ready to pay"; coin and quoted amounts unchanged |
| Y8 | Admin: payments waiting too long | Implemented (unit); admin page needs an admin sign-in to view | Amber pill "No update from Stables for Nh (IN_PROGRESS)" / "Deposit not received for Nh" (`lib/payments/stuck.ts`) |
