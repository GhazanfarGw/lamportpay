# Revenue work plan (master roadmap: Phase 2 fee items + Phase 3 revenue engine)

**Status: IN PROGRESS.** Phase 2 is the current phase of the master roadmap (see docs/ROADMAP.md).

> **Correction 2026-09-30 (owner):** LamportPay charges **one fee of 2%** (all LamportPay
> revenue), not a 2% conversion fee plus a 2% swap fee. Stables' fees, Jupiter's own swap
> fees and network fees are separate provider costs paid by the user and are not part of the
> 2%. The swap-fee path below is dormant: `swapFeeBps` must be
> 0 and is refused otherwise, and the admin UI shows a single "LamportPay fee". Where this
> file still says "2% conversion and 2% swap", read it as history. Phases and trackers now
> live in `docs/ROADMAP.md`.
>
> **Phase numbering (30 Sep):** per the master roadmap, configurable fees, the non-custodial fee
> split, the fee ledger, the audit trail and the dApp shell are **Phase 2** scope; the pricing
> snapshot, ledger categories, fee audit and admin pricing screen are **Phase 3**. This file's
> "Phase 3" label predates that alignment.

## Owner decisions (2026-09-29)

- Stables does not settle an integrator fee for us: LamportPay collects its own fee, and Stables
  must receive only the settled (net) amount it quoted. Stables has confirmed this is fine.
- **Approved model (non-custodial):** the user's own wallet signs ONE transaction with two
  transfers: the exact Stables-quoted deposit to Stables' deposit address, and the LamportPay fee
  to the LamportPay revenue wallet. Customer funds never pass through a LamportPay wallet; the
  revenue wallet receives only LamportPay's fee.
- **Swap fee:** collected by Jupiter's integrator ("referral") fee during the user's own swap.
- **Fee: 2% on conversion and 2% on swaps**, configuration-driven (never hard-coded).
- One quote shows everything: partner fees (live from Stables), LamportPay fee, total to pay,
  and final bank amount. The revenue wallet address is not shown in the LamportPay UI (the fee
  appears as "LamportPay fee"); the user's wallet will still show the destination when signing.
- KYC and compliance follow the partner (Stables hosted verification, Travel Rule requests,
  compliance holds). No parallel compliance system.
- Bank payout usually arrives within ~1 hour (configurable estimate, `PAYOUT_ESTIMATE_MINUTES`).

## Facts that shape the design

- Jupiter integrator fee: `referralAccount` + `referralFee` on `/order`, allowed **50–255 bps**;
  **Jupiter keeps 20% of the integrator fee** (200 bps → LamportPay nets 160 bps). Jupiter picks
  the fee mint (`feeMint`); a missing referral token account silently drops our fee.
  Requires a Jupiter Ultra referral account and a referral token account per fee mint.
- The Stables deposit must still come from the customer's own verified wallet (Travel Rule), so
  the fee must be a separate transfer in the same user-signed transaction, never a detour.

## Work items

1. **Config:** `LAMPORTPAY_FEE_BPS` (conversion), `LAMPORTPAY_SWAP_FEE_BPS`,
   `LAMPORTPAY_REVENUE_WALLET`, `JUPITER_REFERRAL_ACCOUNT` — server-only, validated at startup.
2. **Quote:** fetch live Stables quote → add LamportPay fee → one fee breakdown and final amount;
   fee stored with the quote so the user pays exactly what they saw.
3. **Funding transaction:** add the fee transfer (USDC/USDT to the revenue wallet's token
   account) next to the Stables deposit; server verifies both amounts and destinations before
   the user signs, and verifies both on-chain afterwards.
4. **Swaps:** send `referralAccount` / `referralFee` server-side; record `feeMint` and fee amount.
5. **Ledger:** record LamportPay fee per payment/swap for revenue reporting and reconciliation.
6. **dApp shell:** marketing site keeps a "Convert" button that opens a separate app layout
   (no footer, focused header): connect wallet, convert/swap, quote, status. Marketing site stays
   static.
7. **Tests:** fee math (rounding, minimums, limits 100–1,000,000), transaction checks (wrong fee
   destination/amount refused), Jupiter fee params, UI quote, no revenue-wallet leak in UI.

## Decisions resolved (2026-09-29)

- Fee is **added on top** of the Stables quote (user pays deposit + 2%); Stables receives exactly
  its quoted deposit.
- Revenue wallet: company-owned, single owner, offline hardware wallet, Solana, **revenue in USDC**.
  Address to be supplied by the owner.
- Limits: minimum 100; **no LamportPay maximum** (`PAYMENT_MAX_*=none`), Stables' per-customer
  limits decide. Stables publishes no limit table; sandbox quotes accepted up to 2,000,000.

## Owner decisions (2026-09-30)

- Fee and revenue wallet are set in `.env` **and** editable from the admin dashboard
  ("Fees and revenue"); the admin value overrides `.env`, "Use .env" clears it.
- **USDC only for now:** USDT payments are turned off (`PAYMENT_ENABLED_CURRENCIES=usdc`, also
  switchable in the admin dashboard). This also settles the "fee in USDT" question.
- Jupiter referral account: to be created by the company wallet (see "Owner steps").

## Done so far

- `src/lib/payments/fees.server.ts`: fee config (`LAMPORTPAY_FEE_BPS`, `LAMPORTPAY_SWAP_FEE_BPS`,
  `LAMPORTPAY_REVENUE_WALLET`, `PAYMENT_ENABLED_CURRENCIES`) with validation, and on-top fee math
  rounded up to the smallest unit. Unset = no fee (Phase 2 flow unchanged).
- Limits: `PAYMENT_MAX_*=none` supported.
- **Business settings** (`src/lib/business-settings.server.ts`, migration
  `20260930120000_business_settings_platform_fee.sql`, **applied to dev only**): one server-only
  row (RLS on, no user grants) overriding `.env` for conversion fee, swap fee, revenue wallet and
  payment coins. Validated as a whole (a fee without a wallet, or no coin, is refused), 10-second
  cache, a read failure pauses payments (503) instead of guessing a fee.
- **Admin dashboard:** "Fees and revenue" section (`BusinessSettingsAdmin.tsx`): admin role
  checked server-side, only changed fields are saved, a new revenue wallet must be typed twice,
  every change goes to the audit log (old → new, reason). No secrets shown or editable.
- **USDC-only switch:** disabled coins are not priced, a request preferring one is refused
  (`currency_disabled`), quoting an older payment in a disabled coin is refused; the pay form only
  offers enabled coins.
- **Conversion fee in the payment flow (non-custodial):** fee snapshot per payment
  (`payments.platform_fee_bps / _minor / _wallet`) taken with the quote; settlement and the
  balance check need amount + fee; the funding transaction has two transfers signed once by the
  user (exact Stables deposit + fee to the revenue wallet, revenue token account created if
  missing, SOL reserve covers its rent); verification requires the exact deposit to Stables,
  records what the revenue wallet received (`platform_fee_received_minor`), and flags a missing
  or short fee as `platform_fee_mismatch` for operations **without blocking a deposit that
  already reached Stables**. The UI shows "Amount converted / LamportPay fee (2%) / Total from
  your wallet"; the revenue wallet address is not part of the payment view.
- **Swap fee:** `referralAccount` + `referralFee` added server-side to swap orders, sizing quotes
  and the /swap preview when `JUPITER_REFERRAL_ACCOUNT` is set and the swap fee is > 0; otherwise
  no fee is sent. Sizing includes the fee, and the existing "minimum output ≥ shortfall" check
  still guards every payment swap.
- Tests: `business-settings.unit.test.ts` (7), fee flow and USDC-only in
  `payments-service.unit.test.ts` (+6), referral params in `jupiter-client.unit.test.ts` (+2),
  fee-aware settlement in `settlement.unit.test.ts` (+1). Unit suite 325/325, typecheck, lint
  (changed files), production build and secret scan pass. The signed-in end-to-end suite was not
  re-run (needs the dev server).

## Decided (2026-09-30): wallet-only payment when a fee applies

- When a payment carries a LamportPay fee, the deposit card shows no copy-and-send instructions
  (no copyable deposit address or amount): the user pays with the wallet button, which sends the
  deposit and the fee in one transaction.
- Recovery stays: if the wallet sent but the page didn't confirm, the user can paste the
  transaction signature. This is offered only once the wallet button prepared the transaction
  (the payer wallet is fixed), and says "Don't send again".
- Safety net unchanged: a deposit that still reaches Stables without the fee is never blocked;
  it is flagged as `platform_fee_mismatch` for the admin.
- Payments without a fee keep the Phase 2 manual option.

## NOT VERIFIED

- Jupiter `/swap/v2/order` with `referralFee` on **ExactOut** sizing quotes (docs list ExactIn
  only); if Jupiter refuses it, payment swaps stop with "Swaps are not available" (no swap
  without the fee is attempted). Must be checked in the live smoke test once the referral
  account exists.
- Which mint Jupiter takes the swap fee in (`feeMint`) for SOL→USDC routes; the referral token
  accounts for SOL and USDC should both exist.
- The whole fee split with real funds (part of the controlled real-money test).

## Owner steps (cannot be done by LamportPay's server — needs the company wallet's signature)

1. Send the revenue wallet address, then set it (admin dashboard → Fees and revenue, or
   `LAMPORTPAY_REVENUE_WALLET`) together with the 2% conversion fee (`200` bps).
2. At https://referral.jup.ag/ connect the company wallet, create the referral account, and
   create referral token accounts for **USDC and SOL** (small SOL rent each).
3. Put the referral account address in `JUPITER_REFERRAL_ACCOUNT` (public address, not a secret)
   and restart/redeploy. The 2% swap fee then starts automatically.

## Still needed

- dApp app shell (Convert button → focused app layout).
- Revenue reporting view (fees received per period) in the admin dashboard.
