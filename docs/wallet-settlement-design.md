# Wallet assets, settlement choice and Jupiter (Phase 2 design proposal)

## Status

**Implemented on 2026-09-28/29** (uncommitted, Phase 2 branch), with these differences from the
proposal below:

- **Built:**
  - `settlement.ts`: the rule, with 19 tests including the 2026-09-27 sandbox matrix.
  - `settlement.server.ts`: Stables previews per coin, plus real balance reads through
    `solana-balances.server.ts`.
  - Payment creation with Automatic / USDC / USDT and an optional wallet.
  - The settlement re-check route, which is throttled and locked after the quote or any swap.
  - The production readiness gate before the firm quote. In the sandbox it is recorded only.
  - The `payment_swaps` table (migration `20260928120000_payment_swaps.sql`, applied to dev
    only) and `deposit_currency` / `deposit_network`.
  - The Jupiter server client and the swap order / execute / confirm routes, with the in-flight
    lock and on-chain confirmation.
  - The funding guards (live transfer check, balance and SOL checks, payer bound to the swapping
    wallet) and `transfer_create_failed` with Stables' correlation ID.
  - The pay-page settlement card and swap panel.
  - Removal of mock routing and `/send`'s fake hash.
  - Sign-in on `/api/jupiter/*`.
- **Probes done** (answers in "Testing plan" step 1 terms):
  - ExactOut works, but switches the order to `manual` mode.
  - Jupiter's fee is on the input mint.
  - Errors can come back as HTTP 200 with an `error` field.
  - Gasless orders put Jupiter's relayer first as fee payer.
- **Deviations:**
  - Swaps are sized with a read-only ExactOut quote plus a 0.5% buffer, then ordered ExactIn.
    The guaranteed minimum output must cover the shortfall.
  - **Gasless orders are refused**: their transaction ID is known only after relaying, so a
    failed relay could not be tracked.
  - Wallet UI uses one provider per island, sharing the connected key, not one page-wide
    provider.
  - The "top-up swap after the transfer" is **not** built.
  - The admin swap view is not built; swaps are visible on the payment timeline.
- **Still unverified (sandbox-limited):** the swap and funding legs, and wallet modification of
  transactions while signing. They need the owner-started real-money test.

The original proposal text follows, unchanged.

- This was a proposal. None of it was built, and no code, migration or config was changed to write it.
- It combines two draft designs and an adversarial review. The base is the "incremental" design, which keeps the existing flow and state machine. Safety parts come from the "settlement plan first" design: swap tracking, an in-flight lock, and on-chain checks of swap results. Every item the reviewer marked "must fix" is handled below.
- **Recommendation: don't start building until the current Phase 2 verification blockers are closed.** Those blockers are:
  - real Stables webhooks received through the dashboard (Svix) endpoint;
  - the `POST /transfer` 500 incident recorded and raised with Stables;
  - USDT marked unverified until a real sandbox transfer completes.
- Two small pieces could go in earlier, if the owner agrees. They collect evidence and change no payment decision:
  1. A `transfer_create_failed` payment event. It stores Stables' HTTP status, error code, message and request-id header when `POST /transfer` fails. This supports blocker 2.
  2. Removing the hard-coded USDC defaults (`pay.tsx:340`, `routes/api/payments/index.ts:15`, `service.server.ts:502`).
- Several points depend on Jupiter behaviour we haven't confirmed yet. They are marked **(probe first)**. No sizing code gets written until the read-only probes in the Testing plan answer them.

## Goal

When a user pays, LamportPay should:

1. Read the connected wallet's real balances.
2. Ask Stables which settlement coins (USDC, USDT on Solana) it can price for this destination and amount.
3. Pick a coin the user already holds in full, when there is one. In that case there is no swap.
4. Offer a Jupiter swap only when no priced coin is held in full. The swap goes into the user's own wallet, and the user signs it.
5. Then send exactly the Stables deposit amount to the Stables deposit address, in a second transaction the user signs.

This replaces the standalone SOL → USDC demo panel on `/pay`.

## Constraints

1. **Non-custodial.** LamportPay never holds, routes or controls user funds. It never asks for, stores or handles private keys or seed phrases. The user signs every transaction in Phantom or Solflare.
2. Balance detection and Jupiter are part of the payment flow, not a separate demo page.
3. Jupiter runs only when the user doesn't already hold a coin Stables will accept for this payment.
4. USDC is not the only settlement path. The candidates are `PAYMENT_CURRENCIES` (USDC, USDT on Solana), narrowed to what Stables actually prices for this destination and amount.
5. The Stables quote and transfer responses decide the currency, network, address and amount. No Stables endpoint or behaviour is invented.
6. No fake wallet balances and no fake settlement transactions anywhere in the product. Tests may mock, at unit level only.
7. Stables credentials and `JUPITER_API_KEY` stay server-side.
8. Every Stables write keeps its `Idempotency-Key`. Webhooks stay Svix-verified. The Stables transfer state stays authoritative.
9. Amounts are `bigint` minor units. Limits come from `PAYMENT_MIN/MAX_*` config.
10. No hard-coded countries or currencies. No Phase 3/4 features. KYC stays on Stables' hosted page.
11. The user is never asked to send more or less than the Stables deposit amount, and never has to copy and paste the deposit address.

## What exists today

- **No balance detection.** `src/` never calls `getBalance`, `getTokenAccountsByOwner` or `getTokenAccountBalance`. The only balance data is the after-the-fact `tokenDelta` (`src/lib/solana-usdc.server.ts:48-59`).
- **The coin is chosen blind and fixed at creation.**
  - The user picks it in a dropdown that defaults to USDC (`pay.tsx:340`, `377-388`).
  - It is stored once as `payments.source_currency` (`service.server.ts:549-551`).
  - Only that coin is preview-priced (`service.server.ts:527-547`).
  - Quote, transfer, funding and verification all read it back through `currencyOf` (`service.server.ts:94`, `650`, `923`, `1089`, `1137`).
- **Stables' deposit instructions are checked, not adopted.** `readDepositInstructions` (`service.server.ts:848-884`) requires:
  - the same coin as the payment row;
  - network `solana`;
  - a valid public key (the sandbox placeholder is accepted in the sandbox only);
  - an amount exactly equal to `source_amount_minor`.
- **Funding is real and production-only.**
  - `buildFundingTransaction` builds an unsigned exact-amount `TransferChecked` (`service.server.ts:1073-1107`; `solana-usdc.server.ts:84-143`).
  - `verifyUsdcDeposit` checks at finalized (`solana-usdc.server.ts:177-237`) that the deposit address received exactly the amount, the payer signed, and the payer's own balance of that coin fell by exactly the amount (`:221-228`).
  - Because of that last check, a swap and the deposit in one transaction would be rejected.
  - `requireLiveFunding` blocks funding in the sandbox (`service.server.ts:1056-1062`).
- **Jupiter is an unconnected demo.**
  - SOL → USDC only, 0.001-0.01 SOL. At the 2026-09-27 quote that is about 1.23 USDC, against a 100 minimum payment.
  - The `/api/jupiter/{quote,order,execute}` routes have no login check and no payment link. `quote.ts` falls back to mock routing.
  - The panel appears on `/pay` only for USDC deposits, without its callback (`pay.tsx:1146-1155`).
- **Fake settlement data exists in the product:**
  - `/send` uses `mockSolanaHash` (`src/components/site/demo-data.ts:57`, `send.tsx:418`);
  - the `SwapRoutePreview` mock routing;
  - `swap-route.ts` `MOCK_SOL_USD`;
  - the `quote.ts` mock fallback.
- **Reusable as-is:** `rpc()` (`solana-rpc.server.ts:17-30`), `tokenDelta`, `isValidPublicKey`, `stables.getTransfer` (`client.server.ts:187`), the `FORBIDDEN_FIELDS` and `FORBIDDEN_KEY_FIELDS` guards (`order.ts:14-25`, `execute.ts:22-30`), and the SwapPanel sign sequence (`SwapPanel.tsx:162-242`).

## Decision rule

The rule is a pure function, `decideSettlement()`, in the new file `src/lib/payments/settlement.ts`. It does no I/O and uses `bigint` only.

### Inputs

- `A` is the amount in minor units. It is the same for USDC and USDT, since both have 6 decimals.
- Country and payout currency are the user's choice. There is no list.
- **Holdings** are read from mainnet for the payer wallet:
  - SOL lamports;
  - the associated token account (ATA) balance for each `PAYMENT_CURRENCY_MINTS` mint. Only the ATA counts, because the funding builder spends only from it (`solana-usdc.server.ts:93`).
  - If the RPC read fails, holdings are `unavailable`. They are never set to zero.
- **Candidates.** Each coin in `PAYMENT_CURRENCIES` that passes `getPaymentLimits(c)` gets a Stables preview quote: `POST /api/v1/quotes` with `preview:true`, a fresh `Idempotency-Key`, and network `solana`. All candidates are quoted in parallel. Each result is classified:

| Result | Classification |
|---|---|
| 2xx, and the source currency, amount (exact), network (`solana` or absent) and destination currency all match | `priced`. Keep the destination amount, rate and fee. |
| `amountRejected()` matches | `amount_rejected` |
| `ROUTING_QUOTE_FAILED`, 429, 5xx or timeout | `unavailable` (temporary, not a verdict) |
| Any other 4xx (`ROUTING_ROUTE_NOT_CONFIGURED`, `ROUTING_ROUTE_DISABLED`, …), or a 2xx that fails the checks | `unsupported` |
| Outside config limits (Stables is not called) | `out_of_limits` |
| 401 or 403 | Thrown as a configuration error |

- **Preference.** The user may choose "Automatic" or a coin. A preference only chooses among options that need no swap. It can never cause a swap.

### Rule, in order

Let `P` be the priced coins.

1. **Nothing priced.** Return the existing errors: `503 quote_unavailable` if any coin was `unavailable`, otherwise `422 amount_rejected` or `422 destination_not_supported`.
2. **Holdings unknown.** This happens when there is no wallet yet or the read failed. Mark the choice *tentative*: the preference if it is priced, otherwise the best payout in `P`. A tentative choice can't lead to a swap and can't be quoted in production. The user must connect a wallet first (see Flow step 4).
3. **Held in full.** Let `HELD` be the coins in `P` with ATA balance ≥ `A`. If `HELD` is not empty:
   - choose the preference if it is in `HELD`;
   - otherwise the largest preview destination amount (USDC and USDT did price differently, for example GBP 0.7444 vs 0.74693);
   - on a tie, the lower fee, then the `PAYMENT_CURRENCIES` order.

   **No Jupiter.** A held coin is never swapped for a better rate.
4. **Held, but temporarily unpriced.** If some coin with ATA balance ≥ `A` was `unavailable`, return `503 quote_unavailable` ("try again"). A Stables hiccup must not push the user into a swap they don't need.
5. **Swap needed.** No priced coin is held in full. The target is the coin in `P` with the smallest shortfall (`A − ATA balance`). Ties go to the preference, then the best payout, then the list order. Swap inputs are SOL and the other payment stablecoin, each with a real balance above zero. If no input can cover the shortfall, the status is `insufficient_funds` and the user is told what to add.
6. **Not enough SOL.** If SOL is below the reserve (see below), the status is `needs_sol`. Jupiter is never used to turn the payment coin into SOL.

Worked examples from the 2026-09-27 sandbox:

- USD payout, wallet holds only USDT: USDT is `unsupported` (not configured), so the target is USDC and a swap is required.
- GBP payout, wallet holds both coins in full: both are priced, so the better GBP payout wins, with no swap.
- EUR payout: both coins are `unsupported` (disabled), so the result is `422 destination_not_supported`.

### SOL reserve

The reserve is checked before anything is signed. It is the sum of:

- the funding transaction fee (`getFeeForMessage` on the built message);
- rent for the deposit address's token account, when it doesn't exist yet (`getMinimumBalanceForRentExemption(165)`);
- for a swap:
  - the swap's own fee, including priority fee (`getFeeForMessage` on the Jupiter message);
  - rent for the user's output token account if it is missing;
  - rent for the temporary wrapped-SOL account when the input is SOL;
- plus a margin, `SOLANA_FEE_RESERVE_LAMPORTS`, from config.

If the SOL balance can't cover the whole sum, the request is refused before any signing. **(probe first: who pays fees in Jupiter's v2 orders.)**

### When the coin is locked

- The coin (`source_currency`) can be re-chosen only in `PAYMENT_CREATED`, `KYC_PENDING` or `KYC_APPROVED`, only with `quote_id` null, and only when no swap attempt exists for the payment.
- The write is status-guarded (`updatePaymentIfStatus`).
- `quotePayment`'s write to QUOTED also has to match the `source_currency` it quoted (compare-and-set). That way a re-choice can't race a firm quote. Transfer creation needs QUOTED, so it can't race a re-choice either.
- Once a transfer exists, the coin is whatever Stables' `source_deposit_instructions.currency` says. It is stored as `deposit_currency` (see Data model).

## Flow

"User signs" always means in Phantom or Solflare. Nothing else is ever signed.

1. **Sign-in and KYC** work as today, on Stables' hosted page. Nothing is signed.
2. **New payment.**
   - The user enters the amount, country and payout currency.
   - "Pay with" is Automatic (the default), USDC or USDT.
   - Connecting a wallet here is recommended. It is connecting, not signing: only the public key is sent.
   - `POST /api/payments` → limits per coin → parallel Stables previews → mainnet holdings read → `decideSettlement` → the payment row with `source_currency`, and a `settlement_selected` event.
3. **Settlement card** (pre-transfer states). It shows the real balances with the read time, Stables' answer for each coin, the chosen coin and the reason, and the status. The user can connect or re-check. A re-check runs the rule again under the lock rules above.
4. **Readiness gate** (production only, before "Get quote"). The wallet must be connected, the choice must not be tentative, and the status must be `funds_ready` or `swap_required`.
5. **Swap, only if `swap_required`**, and only in `KYC_APPROVED`:
   1. `POST /api/payments/:id/swaps`. The server runs, in order:
      - a fresh Stables preview for the chosen coin (must be `priced`);
      - a fresh holdings read (if the shortfall is now 0, it answers `409 swap_not_needed` and writes `funds_ready`);
      - the in-flight lock check.

      It then calls Jupiter `swap/v2/order` with `x-api-key`. The server sets taker = payer wallet, input and output mints from the decision, and a size that covers the shortfall. No receiver or fee fields are sent, and none come from the client. It checks the SOL reserve and stores a `payment_swaps` row (`ordered`) with the message hash. It returns the unsigned transaction and its terms.
   2. A confirm dialog shows what the user spends and the minimum they receive. It says the output lands in their own wallet and stays there if Stables later refuses the payment.
   3. **User signs #1** (`signTransaction`). The wallet doesn't broadcast.
   4. `POST /api/payments/:id/swaps/:swapId/execute`. The server checks that the signed message matches the stored order and that the taker signed. It marks the row `submitted` and relays to Jupiter `swap/v2/execute`.
   5. `POST …/swaps/:swapId/confirm`, polled by the client. `getTransaction` at finalized confirms that the taker's output token balance rose by at least the order's minimum output. The row becomes `landed`, holdings are re-read, and the status becomes `funds_ready`.
6. **Firm quote.** `quotePayment`, unchanged, plus two checks: `quote.source.network` and `quote.status`. The quote lasts 5 minutes. The swap is already done, so it takes none of that time.
7. **Transfer.** Bank details (holder locked to the Stables record), `POST /payment-methods/validate`, `POST /transfer` with the deterministic key, and `readDepositInstructions`, all unchanged. In addition:
   - Stables' currency and network are stored in the new `deposit_currency` and `deposit_network` columns.
   - A failure writes `transfer_create_failed`. The user's swapped coins stay in their own wallet.
8. **Funding.** `POST …/funding-transaction`. Before building, the server:
   - fetches the **live Stables transfer** (`GET /transfers/{id}`), applies any forward state change through the existing reconcile path (`service.server.ts:~1571-1605`), and refuses unless the transfer is still awaiting funds;
   - re-reads balances: the ATA of `deposit_currency` must hold at least `deposit_amount_minor`, and SOL must cover the reserve.

   It then builds the same exact-amount `TransferChecked` to Stables' address. **User signs #2** (`sendTransaction`). The user never types the amount or the address.
9. **Verification.** `verifyFunding` → `verifyUsdcDeposit`, unchanged, except that the mint comes from `deposit_currency`.
10. **Status.** Svix webhooks and reconciliation move the payment to COMPLETED, as today. Swap and settlement events never change `PaymentState`.

**Top-up after the transfer.** Sometimes funding fails with `insufficient_balance` because the user moved funds. Then a top-up swap into `deposit_currency` may be offered. It goes through the same live `GET /transfers/{id}` check first, and the same lock and binding rules.

## Data model and migration

One additive migration, `supabase/migrations/2026MMDDhhmmss_payment_swaps.sql`, applied to the dev project `gdksfksypkcfiohozzsx` only.

- **New table `public.payment_swaps`**, one row per Jupiter attempt:

  | Column group | Columns |
  |---|---|
  | Keys | `id` uuid pk; `payment_id` fk, `on delete cascade`; `attempt` int, `unique (payment_id, attempt)` |
  | State | `status` in (`ordered`, `submitted`, `landed`, `failed`, `expired`, `abandoned`) |
  | Order | `taker`; `input_mint`; `output_mint` (the USDC or USDT mint); `swap_mode`; `shortfall_minor` bigint; `in_amount_minor`; `min_out_minor` bigint, `check (min_out_minor >= shortfall_minor)`; `slippage_bps`; `price_impact_pct`; `jupiter_request_id` unique; `order_message_sha256`; `last_valid_block_height` bigint |
  | Result | `signature` unique, nullable; `jupiter_status`; `jupiter_error`; `actual_in_minor`; `actual_out_minor` (from on-chain `tokenDelta`, not from Jupiter's report); `failure_reason` |
  | Times | `created_at`, `updated_at` |

- **In-flight lock.** A partial unique index on `(payment_id) where status = 'submitted'`. A new order also marks any earlier `ordered` row `abandoned`. `submitted` is cleared only by one of these:
  - a finalized on-chain result (`landed` or `failed`);
  - the current block height passing `last_valid_block_height`, followed by a finalized balance re-read (`expired`).

  The lock is checked and cleared on the next swap, wallet-check or confirm request, not only by the daily cron. A closed tab therefore blocks for about 60-90 seconds, not a day.
- **New columns on `payments`:** `deposit_currency` (check in `usdc`, `usdt`) and `deposit_network` (check = `solana`). Both are copied from Stables' `source_deposit_instructions` when the transfer is stored.
- **RLS and grants** follow `20260926230000_phase2_grants_hardening.sql`. The payment's owner and admins can select. Only the service role writes. `anon` gets nothing.
- **New `payment_events` kinds.** The `kind` column is free text, so no migration is needed:

  | Kind | Detail |
  |---|---|
  | `settlement_selected` | every candidate's verdict, Stables code and preview destination amount; holdings as minor-unit strings or `unavailable`; the slot; the choice, reason and tentative flag |
  | `settlement_changed` | — |
  | `swap_ordered`, `swap_submitted`, `swap_landed`, `swap_failed`, `swap_expired` | — |
  | `funding_blocked` | the live transfer status, or the balance shortfall |
  | `transfer_create_failed` | Stables' status, code, message and request-id header |

- No new `PaymentState`. `state.ts` is unchanged.
- The ledger (`ledger.server.ts`) gains `insertSwapAttempt`, `markSwapSubmitted` (only from `ordered`), `markSwapOutcome` and `currentInFlightSwap`. Supabase types are regenerated.

## API and UI changes

**New server modules**

- `src/lib/solana-balances.server.ts`: `readWalletHoldings(owner)` over `rpc()` with `SOLANA_RPC_URL`, and `solReserve(...)`.
- `src/lib/jupiter/client.server.ts`: `getOrder` and `execute`. This is the only place that reads `JUPITER_API_KEY`. It is strict and has no mock fallback.
- `src/lib/payments/settlement.ts`: `decideSettlement`.

**Changed and new routes.** All new routes use `handleUserRequest`, an ownership check and `.strict()` schemas.

- `POST /api/payments`:
  - `sourceCurrency` loses `.default('usdc')`;
  - new `preferredCurrency` (`auto` | coin, default `auto`);
  - new optional `wallet` (a base58 public key).
- New `POST /api/payments/:id/settlement` `{wallet, preferredCurrency?}`: re-check. It follows the lock rules and is throttled to one call per 5 seconds, since each call makes up to two Stables previews.
- New `POST /api/payments/:id/swaps`. The client sends no mints, amounts or taker.

  | Error | Code |
  |---|---|
  | 409 | `swap_not_needed`, `swap_in_flight`, `sandbox_swap_disabled`, `not_kyc_approved`, `settlement_changed` |
  | 422 | `swap_not_covered`, `insufficient_swap_input`, `needs_sol` |
  | 503 | `swap_unavailable`, `balance_unavailable` |

- New `POST /api/payments/:id/swaps/:swapId/execute` `{signedTransaction}`. It rejects key-material fields. It relays only a transaction that matches the stored order and is signed by the taker. It is idempotent: a `submitted` row is never relayed twice.
- New `POST /api/payments/:id/swaps/:swapId/confirm`. It answers 202 until the result is final.
- `POST …/funding-transaction` adds the live transfer check and balance guards: `409 transfer_not_open`, `409 insufficient_balance {held, needed}`, `409 insufficient_sol {solNeeded}`, `503 balance_unavailable`. The mint comes from `deposit_currency`.
- `POST …/funding` (`verifyFunding`, `service.server.ts:1137-1176`) takes its mint from `deposit_currency`.
- `view.ts:307-316` takes the deposit currency and network from the `deposit_*` columns. `PaymentView` gains `settlement` and `latestSwap`.
- `POST …/transfer` writes `transfer_create_failed` on a Stables error. The response is unchanged.

**Demo routes and fake data (must-fix)**

- `/api/jupiter/{order,execute,quote}` are either retired or gated to admins, whichever the owner picks. They must stop spending the Jupiter key for anonymous callers.
- The `quote.ts` mock fallback, `SwapRoutePreview`'s mock mode, `swap-route.ts` `MOCK_SOL_USD`, and `/send` with `mockSolanaHash` are removed from the product or put behind admin.
- A unit test fails if anything under `src/lib/payments` or `src/routes/_authenticated` imports them.

**UI**

- **One wallet provider for the whole page.** `PayPage` wraps the form and the payment panel in a single wallet provider, replacing the separate per-island providers on `/pay`.
- **`NewPaymentForm`:**
  - an optional "Connect wallet so we can use what you already hold";
  - "Pay with: Automatic / USDC / USDT";
  - the `?? "100"` fallback at `pay.tsx:372` is removed.
- **`SettlementCard`:**
  - shows only real balances, with the read time; "We couldn't read your wallet" when a read fails, never zero;
  - Stables' answer per coin;
  - the chosen coin with a plain reason, for example "USDC chosen: USDT can't pay out USD";
  - actions: Connect, Re-check, Swap.
- **`PaymentSwapPanel`** replaces the demo `SwapPanel` on `/pay`:
  - no amount input, because the server sizes the swap;
  - the steps are shown as "1 of 2: swap into your wallet" and "2 of 2: send exactly N".
- **`DepositCard`:**
  - the USDC-only demo swap (`pay.tsx:1146-1155`) is removed;
  - the network label comes from `deposit.network`;
  - Send stays disabled until the balance and SOL checks pass;
  - the manual "sent from another wallet" path stays secondary and collapsed. It warns that exchange withdrawals often subtract a fee, which would deliver the wrong amount. It is never suggested when a swap fails.
- **Copy fixes:** the Travel Rule card and `FundingPanel` stop saying "USDC" when the coin is USDT, and "Fiat payout is disabled" disappears from `/pay`.
- **Branding:** new copy says "swap" and doesn't name Jupiter until the owner decides on white-label branding.

## Failure handling

| Situation | What happens |
|---|---|
| Stables prices neither coin (for example EUR, or INR/PHP) | Existing `422 destination_not_supported` or `amount_rejected`, with Stables' reason. No payment row is created. |
| The coin the user holds is temporarily unpriced | `503 quote_unavailable`, retry. No swap into the other coin. |
| Balance RPC fails | Holdings are `unavailable`, never zero. The choice stays tentative, and every swap or funding step refuses (`503 balance_unavailable`). |
| A wallet connects after creation and holds the other coin in full | A re-check switches the coin (allowed before QUOTED, with no swap attempt). No swap. |
| The user already holds enough when a swap is requested | `409 swap_not_needed`, enforced on the server. |
| Double click, second tab, or an execute that timed out | The in-flight lock returns `409 swap_in_flight`. The lock is cleared only by a finalized result or by passing `last_valid_block_height`, then a finalized balance re-read. No double swap. |
| The user rejects signing or closes the tab after the order | The row stays `ordered`, then `abandoned` on the next order. An unsigned transaction can't land. |
| The wallet changes the transaction while signing | The message doesn't match, so nothing is relayed and a `wallet_modified_transaction` event is recorded. **(probe first: if Phantom or Solflare always do this, switch to an invariant check: taker, blockhash, Jupiter program.)** |
| Jupiter reports success, but less output arrived on-chain | The chain wins: the row is `failed` (`output_not_received`), holdings are re-read, and funding is never built from Jupiter's numbers. |
| No route, minimum output below the shortfall, or slippage or price impact above config | Refused before signing. Nothing moves. The user can retry or top up the coin directly. |
| Not enough SOL for all fees and rent | `needs_sol` or `409 insufficient_sol` with the real amount, before signing. |
| The swap lands, then the firm quote or `POST /transfer` fails (for example the 500s since 14:03 UTC) | The coins stay in the user's own wallet, which the dialog already said could happen. `transfer_create_failed` stores the evidence. A retry uses a fresh quote, so a fresh idempotency key. |
| The Stables transfer expired or was cancelled before funding | The live `GET /transfers/{id}` check refuses (`409 transfer_not_open`) and advances our state. Nothing is sent to a closed transfer. |
| Stables' deposit instructions name another coin, network or amount | The existing `readDepositInstructions` problem path: no deposit address is stored, and no funding or swap is possible. |
| The user swaps with wallet A, then connects wallet B | Once a swap has landed, the payer is bound to the taker, and funding from another wallet is refused with a clear message. |
| A deposit already arrived with the wrong amount (`depositIssue`) | Swap and funding refuse. The page says "Do not send again". |
| Sandbox | See below. |

## Sandbox vs production

| Step | Sandbox | Production |
|---|---|---|
| Stables previews for each coin | Real sandbox answers | Real |
| Wallet balance read | Real mainnet data, informational (owner to decide whether to show it) | Real, enforced |
| Readiness gate before quote | Not enforced; the skip is logged in the event | Enforced |
| Jupiter order and execute | `409 sandbox_swap_disabled` (Jupiter is mainnet-only) | Live |
| Funding and verification | Disabled (placeholder address, `requireLiveFunding`) | Live |
| Deposit | Admin `simulate-deposit` | The user's signed transfer |
| Status | Webhooks and reconcile | Webhooks and reconcile |

Wallet signing, deposit detection and the Jupiter leg stay marked **sandbox-limited**. They can be verified only in the owner-started real-money test. USDT stays **unverified** until a real sandbox USDT transfer completes.

## Testing plan

No fake balances or fake settlement transactions are used anywhere outside unit tests.

1. **Read-only Jupiter probes, before any sizing code.** Call `swap/v2/order` without a taker, so nothing is signed, at the payment-minimum size for SOL→USDC, SOL→USDT and USDT→USDC. Record:
   - the response fields (`inAmount`, `outAmount`, `otherAmountThreshold`, `slippageBps`, `priceImpactPct`, `routePlan`);
   - whether `swapMode=ExactOut` and a `slippageBps` parameter are accepted;
   - whether Jupiter's own fee is taken before or after `otherAmountThreshold`;
   - who is the fee payer and first signer, including gasless and RFQ routes.

   Store the answers in the runbook.
2. **Unit tests with mocks** (Vitest, reusing the existing `rpc` and Stables mocks):
   - every `decideSettlement` branch, including the 2026-09-27 matrix as fixtures, and `bigint` comparisons;
   - holdings parsing: missing ATA gives 0; wrong mint or owner, or a frozen account, gives 0; an RPC error gives `unavailable`;
   - the SOL reserve;
   - the swap lifecycle and the in-flight lock;
   - execute message binding: a stale request id or a mismatched message is refused;
   - the confirm check on the output delta;
   - the live transfer check before funding;
   - `deposit_currency` used in build, verify and view;
   - the `quotePayment` compare-and-set;
   - the no-mock-imports check;
   - a byte-layout test for `buildUsdcTransferTransaction` (missing today).
3. **Read-only live checks:**
   - sandbox previews for both coins against GBP, USD, AUD, NGN, EUR and INR, with no transfer created;
   - `readWalletHoldings` against a known public mainnet address.
4. **Sandbox end to end,** once Stables fixes `POST /transfer`:
   - Automatic coin with a connected wallet;
   - the settlement event is visible;
   - the swap routes answer `sandbox_swap_disabled`;
   - quote, transfer, admin simulated deposit;
   - real Svix webhooks lead to COMPLETED.
5. **Real-money test**, started by the owner, at the configured minimum amount:
   - **A.** The wallet holds the chosen coin: no Jupiter call, direct funding, COMPLETED.
   - **B.** The wallet holds only SOL: a swap of the shortfall into the own wallet, then exact funding, then COMPLETED.
   - **C.** A USDT payment on a USDT-priced route (for example GBP).

   Record the swap signature, funding signature, events and webhooks.

## Open questions

**For the owner**

1. Should this be built in Phase 2 after the blockers close, or in the next phase? It can only be fully verified in the real-money test.
2. Can the two evidence-only pieces (`transfer_create_failed`, removing the USDC defaults) go in now?
3. Should the demo pages and routes (`/send`, `/swap`, `/api/jupiter/*`) be retired or gated to admins?
4. May the UI name Jupiter, or only say "swap" (white-label)?
5. Should real mainnet balances be shown in the sandbox?
6. Should the manual USDC/USDT preference stay, or should the choice be fully automatic?
7. Should swap inputs stay limited to SOL and the other stablecoin, or allow other tokens (later, if at all)?

**For Stables**

1. How long does an unfunded transfer stay open? `source_deposit_instructions` has no `expires_at`.
2. Is the preview's `destination.amount` what the user actually receives? Can it be compared across coins?
3. Does Stables store a 5xx result under an `Idempotency-Key`?
4. What caused the `POST /transfer` 500s from 14:03 UTC on 2026-09-27?
5. Is `destination.amount` (exact-out) available on our routes?
6. Are two preview quotes per decision acceptable under rate limits?

**For Jupiter**, or answered by the probes

1. Is ExactOut supported on `swap/v2/order`?
2. Is `otherAmountThreshold` enforced on-chain for every route type?
3. Is Jupiter's fee taken before or after that threshold?
4. Who pays the fee in gasless or RFQ mode?
5. Do Phantom or Solflare change the transaction while signing?

## Effort estimate

About 8 to 10 engineering days, plus one owner-run real-money session:

| Work | Days |
|---|---|
| Read-only Jupiter probes and write-up | 0.5 |
| Holdings reader, `decideSettlement`, multi-coin previews, lock and compare-and-set rules | 1.5 |
| Migration (`payment_swaps`, `deposit_*`), RLS, types, ledger functions | 1 |
| Jupiter server client; swap order, execute and confirm; in-flight lock; SOL reserve | 2 |
| Live transfer check, funding guards, `deposit_currency` in build, verify and view | 1 |
| UI: page wallet provider, `SettlementCard`, `PaymentSwapPanel`, `DepositCard` cleanup, copy | 2 |
| Demo and mock removal or gating, and the import test | 0.5 |
| Unit tests, live read-only checks, runbook | 1.5 |

The settlement choice can be checked in the sandbox once Stables' `POST /transfer` works again. The swap and funding legs can only be checked in the real-money production test.