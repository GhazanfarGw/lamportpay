# LamportPay

**From your Solana wallet to your own bank account. Non-custodial.**

LamportPay lets a user cash out from a Solana wallet to a bank account in their own name, in one guided flow:

```
Your wallet ──(Jupiter-powered swap, only if needed)──▶ USDC in your wallet
            ──(one user-signed transaction)──▶ licensed payout partner deposit
            ──▶ fiat conversion ──▶ payout to your own verified bank account
```

LamportPay orchestrates the flow and never holds customer funds or keys. The user signs every movement of money in their own wallet. KYC and fiat payout are handled by our licensed payout partner, [Stables](https://stables.money).

> **Status: TEST MODE.** The full flow runs on **Solana devnet + the payout partner's sandbox**. No real funds move. LIVE mode (mainnet + production partner) is built behind a switch but **not enabled**; it follows a security audit and a controlled real-money test.

Live app: https://lamportpay.vercel.app (Convert → `/pay`)
Submitted to: Colosseum Crypto World's Fair 2026 (Solana track)

---

## What works today (TEST MODE)

- **Wallet connect** (Phantom, Solflare) with wallet identity linked to the user account
- **Live quote before paying:** rate, LamportPay fee, partner fee and the exact bank amount
- **Jupiter-powered swap layer** (Jupiter Swap V2 `order` / `execute`): any supported Solana token → USDC, signed by the user, funds stay in the user's wallet; skipped when the user already holds USDC
- **Partner KYC** via the payout partner's hosted verification; LamportPay stores only a status and link, no ID documents
- **Bank details validated** by the partner; payouts only to the verified user's own account
- **One user-signed transaction** sends the exact settlement amount to the partner's single-use deposit address and LamportPay's fee to its revenue wallet. No treasury wallet, no custody
- **On-chain deposit detection**, then live payout status mirrored from partner webhooks (signature-verified, idempotent) plus scheduled reconciliation
- **Receipt** for every payment
- **Admin app:** payments, fees and revenue settings, limits, audit log (append-only), operations cases, emergency controls
- **TEST / LIVE mode separation:** devnet + sandbox keys vs. mainnet + production, enforced server-side

## Business rules (configurable, not hard-coded)

- One LamportPay fee: **2%**, shown as its own line in every quote. Partner fees, Jupiter swap costs and Solana network fees are separate and shown separately.
- Fee, revenue wallet, limits, enabled currencies and payout countries are set by env or Admin → Settings (audit-logged).
- USDC on Solana is the settlement asset (USDT supported in code, currently off).

## Tech stack

- **App:** TanStack Start + Vite, React, Tailwind
- **Solana:** `@solana/web3.js`, Solana wallet adapter (Phantom, Solflare)
- **Swap:** Jupiter Swap V2 API (server-side relay, authenticated, one order relayed once)
- **Payout partner:** Stables API (sandbox), webhooks verified with Svix signatures
- **Database:** Supabase Postgres with row-level security and versioned migrations (`supabase/migrations`)
- **Hosting:** Vercel

## Repository layout

```
src/routes/            pages: marketing site, /pay dApp, admin, API routes (src/routes/api)
src/lib/payments/      fee math, limits, payment state, reconciliation
supabase/migrations/   database schema, RLS and privilege hardening
tests/                 unit and integration tests (Vitest)
scripts/               webhook sender, reconciliation, secret scan
docs/                  roadmap, architecture, security and testing records
```

Key docs: [`docs/ROADMAP.md`](docs/ROADMAP.md) · [`docs/wallet-settlement-design.md`](docs/wallet-settlement-design.md) · [`docs/stables-sandbox-runbook.md`](docs/stables-sandbox-runbook.md) · [`docs/security/pre-live-security-checklist.md`](docs/security/pre-live-security-checklist.md) · [`docs/testing/real-money-test-plan.md`](docs/testing/real-money-test-plan.md)

## Run locally

```bash
npm install
cp .env.example .env      # fill in devnet RPC, Supabase, partner sandbox and Jupiter keys
npm run dev               # http://localhost:8080
npm test                  # Vitest
npm run typecheck && npm run lint && npm run build
```

Never commit `.env`. `scripts/check-repo-secrets.mjs` scans for leaked secrets.

## Security principles

- Non-custodial: no customer funds, private keys or seed phrases are ever held, stored or logged
- No customer identity documents stored; KYC stays with the licensed partner
- Server-side validation of amounts, tokens and addresses; client status is never trusted
- Webhooks: signature-verified, replay-safe, idempotent; payment state follows the partner, not the browser
- RLS on all tables, least-privilege roles, append-only audit log, rate limits

## What is not done yet

- LIVE mode (mainnet + production partner) is not enabled
- Independent security audit
- Controlled real-money end-to-end test (plan in `docs/testing/real-money-test-plan.md`)
- Real-funds Jupiter swaps go live with production

## Development history (disclosure)

LamportPay started on **28 July 2026**, built with Lovable. That export is the first commit in this repo (`11365b0`, "Baseline: original LamportPay export (Lovable)"). It contained the marketing site, a demo send flow with mock data, a small SOL → USDC swap demo with Jupiter quote/order/execute API routes, Solana transaction checks, a placeholder payout API and Supabase auth.

Built during the Colosseum hackathon period (commits from 26 Sep 2026): the Stables payout integration (customers, KYC, bank validation, transfers, deposits), signed webhooks and reconciliation, the `/pay` app, the Jupiter swap layer inside the payment flow (secured relay, swap only when required), the non-custodial 2% fee split, admin app, TEST/LIVE modes, wallet identity, security hardening and tests. `/pay` replaced the demo `/send` flow as the product path.

## Team

Zoaib Ali (Founder & CEO) · Zaheer Muneer (Advisor) · Ghazanfar Abbas (CTO & Lead Developer) · Izzat (Marketing & Community) · Safi Ullah Adam (Advisor, Technology & AI)

## License

Copyright 2026 Lamport Pay Ltd. Licensed under the [Apache License 2.0](LICENSE).
