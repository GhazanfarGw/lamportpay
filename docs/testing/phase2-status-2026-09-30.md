# Phase 2 status (master roadmap) — 30 September 2026

Phase 2 = Stables sandbox flow, including configurable fees, one quote with all fees,
non-custodial fee split, fee to the revenue wallet in USDC, deposit straight to Stables, Jupiter
integrator fee, fee ledger, audit trail and the dApp app shell. **Phase 2 is not closed**; it
waits for the items marked BLOCKED and for the owner's sign-off.

## Requirements

| Requirement | Status | Evidence |
|---|---|---|
| Stables sandbox flow (2.0–2.7) | DONE | Phase 2 verification log 29 Sep; sandbox payments completed |
| Configurable fees | DONE | One total LamportPay fee (2%), `.env` + Admin → Fees & Revenue; separate swap fee refused |
| One quote with all fees | DONE | Cost summary: amount, swap (when one happened), partner fee, LamportPay fee, total, what the bank gets |
| Non-custodial fee split in the user's transaction | DONE (not yet with real funds) | Two transfers, one signature; unit tests |
| Fee to revenue wallet in USDC | BLOCKED BY OWNER | Built; wallet address pending (fee is off until set) |
| Customer settlement directly to Stables | DONE | Exact deposit verified; fee never taken from it |
| Jupiter integrator fee | DONE (by owner decision) | The one 2% covers any swap, so no separate Jupiter fee is charged; referral plumbing kept dormant |
| Fee ledger | DONE | `payment_fee_ledger` (append-only, categories, expected vs received) + fixed pricing snapshot |
| Audit trail | DONE | Admin config changes (old → new, reason) + payment events + fee ledger |
| dApp app shell | DONE | `AppLayout`; redesigned /pay (stepper, cost summary, status timeline with Solana links) |
| Revenue wallet holds fees only | DONE (design + tests) | Fee recipient can never be the deposit address or payer |
| Own-account payouts only | DONE | Owner decision 30 Sep; third-party recipient notes withdrawn |

## Exit criteria

| # | Status |
|---|---|
| E1 webhook status transitions | BLOCKED BY STABLES (reconciliation covers it) |
| E2 GBP transfer reliability | BLOCKED BY STABLES |
| E3 final paid-out amount | BLOCKED BY OWNER (real-money test) + STABLES |
| E4–E8 | DONE |
| E9 signed-in click-through | PARTIAL: public and app pages checked in a browser on 30 Sep; signed-in screens need the owner's click-through (the agent does not sign in with passwords) |

## Test evidence (30 Sep)
- Unit tests: 326 / 326. End-to-end against a local dev server with a signed-in test user:
  43 / 43. Total 369.
- Typecheck, lint (changed files: 0 errors), production build, client-bundle secret scan: pass.
- Database: fee-ledger append-only and pricing-lock triggers verified on the dev database in a
  rolled-back transaction.
- Security review: `docs/security/fee-split-review-2026-09-30.md`.

## Gate
1 Implementation: done except owner-provided wallet · 2 Function testing: done except real
money · 3 Security review: done (sandbox scope) · 4 Technical audit: pending owner/lead review ·
5 Documentation: done · 6 Approval: pending.
