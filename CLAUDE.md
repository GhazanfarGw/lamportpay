# LamportPay: project rules

LamportPay turns stablecoins on Solana into a bank payout, through Stables
(docs.stables.money). Stack: TanStack Start + Vite, Supabase, deployed on Vercel.

The long brief at the top of `README.md` is the original Lovable prompt (Bridge, "demo only",
a fixed corridor list). It is history. Where it conflicts with this file, this file wins.

## Product rules

Change these only on the owner's instruction.

- **Non-custodial, via Stables.** Users send USDC or USDT from their own wallet to the
  single-use deposit address Stables returns for each transfer. LamportPay holds no funds,
  keys or balances; our ledger is a record only. KYC runs on Stables' hosted page: we store a
  link and a status, and build no KYC UI of our own.
- **Own-account bank payouts only.** The account holder name is locked to the Stables
  customer record (`first_name` / `last_name` from verification) and is not editable. No
  third-party recipients, and no mobile wallet, card or cash payouts.
- **No hardcoded countries or currencies.** The user picks a country and currency; a Stables
  preview quote decides whether it is supported, and Stables validates the bank fields
  (`POST /payment-methods/validate`). No corridor lists, no country-specific code.
- **Limits: minimum 100 per payment; maximum = Stables' limits (owner decision 2026-09-29).**
  `PAYMENT_MIN_USDC`, `PAYMENT_MAX_USDC`, `PAYMENT_MIN_USDT`, `PAYMENT_MAX_USDT`, read in
  `src/lib/payments/limits.server.ts` (defaults 100 and 1000000; `PAYMENT_MAX_*=none` = no
  LamportPay maximum, Stables' per-customer limits decide). Don't repeat the numbers anywhere else.
- **USDC and USDT on Solana only** (`PAYMENT_CURRENCIES` in `src/lib/tokens.ts`, mirrored by
  the `payments_source_currency_check` constraint).
- **White-label UI.** The current UI still names Stables in many places (for example
  `src/routes/_authenticated/pay.tsx`). Ask the owner before adding or removing partner
  branding.

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
