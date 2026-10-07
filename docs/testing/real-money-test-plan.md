# Controlled real-money test plan (Phase 2 exit)

**Status: PLAN ONLY. Not executed.** The owner starts this test; nobody runs it on their own.
It is the only way to verify the legs the sandbox cannot: wallet signing, the Jupiter swap,
the on-chain deposit, Stables' deposit detection, fiat conversion and the bank payout.

Flow under test (non-custodial, no LamportPay wallet anywhere in the path):

```
user wallet → (Jupiter swap, only if the wallet lacks the settlement coin) → same user wallet
            → Stables single-use deposit address → fiat conversion → user's own bank account
```

## A. Preconditions (all must be true before the first transaction)

| # | Precondition | Owner | Evidence to keep |
|---|---|---|---|
| A1 | Stables production approval for LamportPay's tenant | Business + Stables | Written confirmation |
| A2 | Production API key (`sti_live_…`), production URL, production webhook endpoint + `whsec_` secret, set only in the deployment's server env | Engineering | Env var names set (never values) |
| A3 | IP whitelisting done if Stables requires it for production | Stables | Confirmation |
| A4 | Corridor confirmed for the test customer (country, currency, bank) and that customer is eligible | Stables | Preview quote succeeds |
| A5 | Test customer fully KYC-verified on production (base level), payout account in the customer's own name | Test user | Stables customer status |
| A6 | Fee configuration decided and live: LamportPay fee and the Stables `integrator_fee` mechanism (see open question F2) | Business + Stables | Written decision |
| A7 | Production limits confirmed: `PAYMENT_MIN_*` = 15 (owner decision 7 Oct 2026, Stables' 15 USD minimum), `PAYMENT_MAX_*` = 1,000,000 or `none` | Business | Env values |
| A8 | Legal/compliance sign-off for operating the flow in the test corridor | Legal | Written sign-off |
| A9 | Stables' answers on: `transfer.updated.status_transitioned` in production, `actual_payout`, deposit address expiry, Travel Rule holds for self-custody wallets | Stables | Slack/email thread |
| A10 | Production webhook endpoint reachable and verified with Stables' test message; reconcile cron schedule set (`RECONCILE_CRON_SCHEDULE`) | Engineering | Delivery log line |
| A11 | Rollback: how to pause new payments (operational toggle or env) if anything is wrong | Engineering | Documented step |

## B. Transaction test

Amount: the configured minimum (**100 USDC**) unless Stables or the business approves a lower
production-only test amount. Do not change `PAYMENT_MIN_*` for the test without explicit approval.

Run 1: wallet already holds USDC (no swap). Run 2 (only after run 1 reconciles): wallet holds SOL
or another token and needs a Jupiter swap into USDC. Optional run 3: USDT (currently unverified).

For each run record, in order:

1. Wallet address, and **balances before** (SOL, USDC, USDT) read from chain (explorer + app).
2. Quote shown to the user: rate, every fee line, total fees, amount to deposit, payout amount, expiry.
3. Stables transfer ID and initial status.
4. Swap (run 2 only): Jupiter order request ID, the signed transaction signature, finalized
   on-chain balance change (input spent, output received **in the same wallet**).
5. Deposit transaction signature to the Stables deposit address; exact amount sent (minor units).
6. **Balances after**, read from chain.
7. Each Stables status the transfer passes through, with the time and the source that moved our
   record (`webhook` / `reconcile` / `api`).
8. Stables deposit confirmation, conversion amount and rate, fee lines, final payout amount.
9. Bank statement line: amount, currency, date, reference.

## C. Reconciliation (all must match; any mismatch fails the run)

| Check | Source A | Source B |
|---|---|---|
| Deposit amount | on-chain transaction | Stables transfer / our `payments` row |
| Swap output stayed in user wallet | on-chain balance delta | `payment_swaps` row |
| Transfer ID | our `payments.transfer_id` | Stables dashboard |
| Final status | Stables `GET /transfers/{id}` | our `payments.status` = `COMPLETED` |
| How it got there | `payment_events` (source per step) | Stables webhook delivery log |
| Fees | Stables quote / transfer | receipt shown to user |
| LamportPay fee | configured value | Stables `integrator_fee` line |
| Payout | Stables `actual_payout` (if provided) | bank statement |
| No double processing | `stables_webhook_events` (unique event IDs) | `payment_events` (one transition per state) |

## D. Failure scenarios

Most are already covered by unit tests with fakes; in production verify only what can be done
safely and without extra loss. None of these may produce a `COMPLETED` payment.

| Scenario | How to exercise | Expected |
|---|---|---|
| Provider unavailable | Unit tests (Stables 5xx/timeout); in prod observe only | Clear error, nothing sent, retry safe (idempotency key) |
| Insufficient balance | Start a payment above the wallet balance | Refused before signing; balance read failure never shown as 0 |
| Failed swap | Unit tests; in prod: reject in wallet | Swap marked failed from chain result; no deposit step |
| Failed / wrong-amount deposit | Do **not** test with real money; see `docs/wrong-amount-deposits.md` | Handled per Stables' answer (OPEN) |
| Rejected bank payout | Cannot be forced safely; observe if it happens | Payment follows Stables to `FAILED`; refund path per Stables (OPEN) |
| Duplicate request | Double-click create / fund; replay execute | One transfer, one relay, 409 on repeats |
| Duplicate webhook | Stables dashboard "resend" of a delivered event | Stored once, answered 200, not re-applied |
| Timeout | Unit tests | No state change on timeout; reconcile catches up |
| Stale quote | Let the quote expire, then fund | Refused; new quote required |

## Stop conditions

Stop and do not run the next step if: any amount differs from the quote by more than the stated
fees, funds appear anywhere other than the user's wallet or the Stables deposit address, a status
moves without a Stables source, or a secret appears in any log.
