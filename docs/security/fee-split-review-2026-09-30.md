# Security review: fee split, fee ledger, admin foundation, app shell (30 Sep 2026)

Scope: code added since the Phase 2 verification of 29 Sep (fee configuration, non-custodial
fee split, fee ledger and pricing snapshot, admin application, app shell, pay page redesign).
Method: code reading against the project security checklist, database
checks on the dev project, Supabase security advisor. No penetration test.

## Findings

| Area | Check | Result |
|---|---|---|
| Custody | Customer deposit goes only to the Stables deposit address; the fee is a separate transfer to the revenue wallet in the same user-signed transaction | Pass (built and verified server-side; tests) |
| Custody | Fee recipient can never be the deposit address or the payer | Pass (refused when building the transaction; ignored when verifying) |
| Amounts | Deposit must equal the Stables quote exactly; payer must send deposit + fee received; integer minor units; fee rounds up | Pass (tests) |
| Fee rule | One total fee; a separate swap fee is refused (config and admin) | Pass (tests) |
| Missing fee | A deposit without the fee still reaches Stables; payout is not blocked; flagged `platform_fee_mismatch` and ledger shows expected vs received | Pass (tests) |
| Pricing integrity | Price fixed at transfer creation; DB trigger refuses changes to the snapshot and fee columns afterwards | Pass (verified on dev DB in a rolled-back transaction) |
| Ledger | Append-only (update/delete refused by trigger); unique key makes writes idempotent; server-only writes; admin-only reads (RLS) | Pass (verified on dev DB) |
| Access control | Every admin server function re-checks the admin role; reads go through the admin's own session (RLS applies) | Pass (code review) |
| Config changes | Fee and revenue-wallet changes need admin role, a valid Solana address, typed confirmation, a reason (enforced server-side) and are audit-logged old → new | Pass |
| Secrets | Admin and status pages show booleans only; no keys in the client bundle (build scan) | Pass |
| Privacy | Revenue wallet address not in the customer view or pricing snapshot | Pass. Note: the `payments.platform_fee_wallet` column is readable by the payment's owner through RLS; the address is public and visible in the transaction they sign anyway |
| Input validation | New server functions use strict zod schemas | Pass |
| XSS / redirects | No raw HTML added; sign-in redirect uses a fixed path | Pass |
| Supabase advisor | `business_settings` and `jupiter_swap_orders` have RLS with no policies (intended: server-only); `has_role` executable by signed-in users (intended: self-only since 29 Sep); leaked-password protection off | Accepted / owner action |

## Open (not blockers for sandbox)
- Leaked-password protection: needs the Supabase Pro plan (owner).
- Rate limiting on payment endpoints: not added in this batch (Phase 10/11).
- Real-funds verification of the fee split: part of the owner's real-money test.
