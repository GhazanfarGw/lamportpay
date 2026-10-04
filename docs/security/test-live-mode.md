# TEST MODE / LIVE MODE

Status: implemented on DEV, 1 Oct 2026. **LIVE MODE is disabled** (code lock closed, no owner
approval, no production configuration).

## Principle

The mode belongs to the **server deployment**, not the browser. A test app and a live app are
separate deployments with separate `.env` files. The header badge only shows what the server
reports; "Switch" asks the server whether the other deployment exists and, after a
confirmation, opens it. Nothing the browser sends can change which endpoints the server calls.

| | TEST MODE (default) | LIVE MODE |
|---|---|---|
| `LAMPORTPAY_MODE` | `test` (or unset) | `live` |
| Solana | devnet (`SOLANA_DEVNET_RPC_URL` or public devnet) | mainnet (`SOLANA_RPC_URL`, required) |
| Assets | devnet test USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Circle faucet) + devnet SOL; no devnet USDT | mainnet USDC / USDT |
| Stables | sandbox URL, `sti_test_` key only | production URL, never a `sti_test_` key |
| Database | dev project (never the live ref) | production project (never the dev ref) |
| Jupiter | **read-only price quotes only** (no taker: no transaction is built, nothing can be signed) — real mainnet prices, fees, price impact and route on `/pay`. Building an order for a wallet and relaying a swap are blocked (Jupiter has no devnet). Owner decision 3 Oct 2026 (replaces the same-day "no calls at all") | quotes and swaps, only while LIVE MODE is fully active (`ok: true`) |
| Payment limits | **1–5,000 USDC sent per payment**, forced by the TEST profile (`MODE_PROFILES.test.paymentLimits`), applied on read in `getBusinessSettings` — stored/admin and `.env` limits are untouched | business settings (admin or `.env`) |
| Real funds | impossible (`test_mode_no_real_funds`) | yes, with an extra warning before each wallet approval |

## Enforcement (server)

- `src/lib/app-mode.server.ts`: `evaluateMode` validates the environment for the mode.
  Mismatch → `ok: false` → every payment API returns **503 `mode_blocked`** (no silent fallback).
  An unknown `LAMPORTPAY_MODE` value also blocks.
- Endpoint guard (`endpointAllowed` / `assertEndpointAllowed`), wired into:
  - Stables config and the Stables HTTP client (before any request)
  - Solana `rpc()` (cluster and host checks; before any request)
  - every Jupiter call: `getOrder` (kind `jupiter_quote` without a wallet, `jupiter_order` with
    one), `executeOrder` (`jupiter_execute`) and the `/api/jupiter/quote` preview route.
    TEST MODE allows only `jupiter_quote`; a mode whose configuration fails (`ok: false`) never
    reaches Jupiter at all.
  - `/pay` calculator (`live-estimate.server.ts`): pay in SOL (ExactIn, the SOL typed) or in USDC
    (ExactOut, SOL cost shown) from Jupiter's read-only quote; values as Jupiter returns them
  - live funding and payment swaps (`requireRealFundsMode`)
- LIVE MODE needs **all** of: the code lock `src/lib/app-mode-lock.ts` opened in a reviewed
  commit, `LAMPORTPAY_LIVE_APPROVED_BY` + `LAMPORTPAY_LIVE_APPROVED_AT`, production Stables URL and
  live key, `SOLANA_RPC_URL` (not a test cluster), production `SUPABASE_URL`, `LAMPORTPAY_LIVE_URL`.
- Public status (`/api/integration-status` → `mode`) hides configuration details; admins see
  them in Admin → System status.

## Audit

`public.app_mode_events` (append-only, admin-read, migration `20261003100000`):
`mode_observed` when a server reports a mode/state different from the last recorded one, and
`switch_requested` for every switch attempt from the app, with the server's answer.

## UI

- Header badge: **TEST MODE** (amber) / **LIVE MODE** (red) / **BLOCKED** or **MODE MISMATCH**
  (red; the page was built for a different mode than the server runs, `VITE_LAMPORTPAY_MODE`).
- `/pay` and the payment screens show a mode notice in the existing notice slot.
- Switch → confirmation dialog → server answer. Today it answers "not available" with a reason.
- LIVE MODE only: a red warning on the funding and swap panels before any wallet approval.

## Owner steps to go live (later, not now)

1. Separate production deployment + production database + production Stables key + mainnet RPC.
2. Owner approval recorded (`LAMPORTPAY_LIVE_APPROVED_BY/AT`).
3. Reviewed commit setting `LIVE_MODE_CODE_UNLOCKED = true`.
4. Admin → System status shows LIVE MODE available; then the controlled real-money test.

## Testing on DEV now

Fund a wallet with **devnet** SOL (Solana faucet) and **devnet USDC** (Circle faucet). Balances on
`/pay` are devnet balances. Swaps are priced but never executed in TEST MODE. Automated proof:
`tests/app-mode.unit.test.ts` (the five required properties).

### TEST MODE "Pay Now" (owner decision 3 Oct 2026)

The Stables sandbox returns placeholder deposit references, not real addresses, so a real devnet
USDC deposit to Stables is impossible. Instead:

1. Pay Now creates the Stables **sandbox** transfer (only for a verified customer).
2. The user's wallet signs a **real devnet transaction that moves no funds**: one SPL Memo
   instruction `LamportPay TEST payment <payment id>` (program
   `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`). Only the devnet network fee is spent. Nothing is
   sent to any LamportPay wallet.
3. `POST /api/payments/:id/test-payment` reads the transaction from **devnet** and checks: TEST
   MODE; the caller owns the payment; the transfer waits for funds; the transaction succeeded, carries
   exactly this payment's memo, is signed by the caller's linked wallet (or, for an email account,
   the wallet the payment was prepared for), is newer than the transfer and was never used before.
   One payment transaction per payment (a second, different one gets 409 `already_paid`).
4. Only then is the sandbox deposit simulated (idempotent per transfer). Status then follows
   Stables (webhooks, or `npm run reconcile` on localhost). Nothing here marks a payment complete.

The panel refuses, before signing, a wallet other than the one the payment was prepared for.
Explorer links use `?cluster=devnet`. In LIVE MODE the endpoint answers 409 `test_mode_only`.
Admin → Payments "Simulate deposit" still exists for admins.
