# Wallet-first identity and KYC link

Status: implemented on DEV (2 Oct 2026). Not verified end to end by a person yet.
Phase: Phase 3 workstream "identity & KYC" (C38–C45 in `docs/ROADMAP.md`).

## Principle

The Solana wallet is the customer's primary identity in the app. A wallet proves **who** the
user is. It never proves **KYC**: verification comes only from Stables' answers, stored in
`stables_customers`.

```
wallet address (verified by a message signature)
   ↓  Supabase Auth web3 identity  (provider 'web3', id 'web3:solana:<address>')
LamportPay user (auth.users.id)
   ↓  stables_customers.user_id
Stables customer (stables_customer_id, external_customer_id = user id)
   ↓  verification_status + base_payout_status (from Stables), verified_at (ours)
```

## Sign-in flow

1. The user opens `/pay`. The calculator works with no wallet and no account.
2. **Connect wallet** (header). If the user is signed out, picking a wallet does both steps:
   connect, then one message signature ("Sign in to LamportPay. This proves you own this
   wallet. It is not a transaction and moves no funds."). An in-app note says the same before
   the wallet opens.
3. Supabase Auth verifies the Ed25519 signature (Sign in with Solana) and issues a session.
   The first time, it creates the user and the web3 identity.
4. If the wallet was already connected (restored), the header shows one **Verify wallet**
   button instead.
5. Email + password stays available as a fallback ("Email account?" in the wallet picker, "Use
   email instead" under the `/pay` button, and `/auth`). It is not the main gate.

Returning customer on the same or another device: connecting the same wallet and signing
signs into the same user (the identity is keyed on the address), so the same Stables customer
and verification come back. Nothing depends on browser storage.

## What is stored (DEV migration `20261002100000_wallet_identity.sql`)

| Table / column | Written by | Purpose |
|---|---|---|
| `auth.identities` (web3) | Supabase Auth only | Source of truth: signature-verified wallet ↔ user |
| `public.user_wallets` | DB trigger on `auth.identities` | Wallet ↔ user mirror for app/admin; `linked_at`, `last_authenticated_at`; one wallet belongs to one user |
| `public.identity_events` | DB triggers | Append-only audit: `wallet_linked`, `wallet_authenticated`, `kyc_status_changed` |
| `stables_customers.verified_at` | DB trigger | When Stables first approved verification + payouts |

RLS: users read only their own rows; admins read all; no client writes. The trigger never
blocks a sign-in (it logs a warning on failure). `user_metadata` is never trusted because a
user can edit it.

## Server rules

- `authenticateUser` reads the wallets from the verified session (`auth.getUser` →
  identities), not from anything the browser sends.
- **Wallet mismatch guard**: an account that signed in with a wallet can create a payment,
  re-check its settlement, or build the funding transaction only from that wallet (403
  `wallet_not_linked`). Email accounts keep the old behaviour (any connected wallet).
- The app shows "Sign in with this wallet to continue" when the connected wallet differs; it
  signs out and asks the new wallet to sign. It never carries a verification over.

## KYC states (`src/lib/identity/kyc-state.ts`)

| State | From stored Stables data |
|---|---|
| `not_registered` | no Stables customer yet |
| `kyc_pending` | `in_progress`, or approved but base payout not approved yet |
| `kyc_action_required` | `requires_action` (includes any refresh Stables asks for) |
| `kyc_verified` | verification **and** base payout `approved` |
| `kyc_rejected` | verification or base payout `rejected` |

Plus `providerUnavailable` when Stables could not be reached: the last stored status is shown
and is never upgraded. Wallet states (no wallet / connected / authenticated / linked /
different wallet) are separate (`walletLinkOf`).

**Returning verified customer**: `GET /api/kyc` answers from our record without calling
Stables (only open verifications are refreshed; webhooks keep records current).

## Email for wallet-only accounts

Wallet accounts have no email. Stables' customer creation takes an email, so the KYC card asks
for it once, only for accounts without one. It is sent to Stables when the customer is created
and not stored by LamportPay. After that the customer exists and it is not asked again.

## OPEN (provider / owner)

1. **Stables:** do verifications expire, and how is that reported (status, webhook)? We map
   any such case to `requires_action` until confirmed.
2. **Stables:** is email required for an individual customer in production, and may a customer
   who verified with email A later be the same person as wallet account B (409 conflict today)?
3. **Owner:** existing email-verified customers who sign in with a wallet get a separate
   account and would verify again. Linking an existing account to a wallet needs a separate,
   signed "link wallet" step (not built; decision needed).
4. **Owner:** one wallet per account today. Multiple wallets per customer would need the link
   step above.
5. Supabase Web3 sign-in requires "Allow new users to sign up" and the app origin in Redirect
   URLs (dashboard settings, per environment).
