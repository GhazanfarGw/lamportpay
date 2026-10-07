# Stables sandbox runbook

The full payment flow against the Stables sandbox, run locally, with what to check at each step:

customer → KYC → quote → transfer → simulate deposit → webhooks → COMPLETED → receipt, plus the
Travel Rule step.

No real money moves. Sandbox deposit addresses are not real, so sending from a wallet is
disabled; an admin simulates the deposit instead.

## 0. One-time setup

1. **Env** (`.env`, or `.env.local`, which overrides it):
   - `STABLES_API_KEY=sti_test_…`
   - `STABLES_API_URL=https://api.sandbox.stables.money`
   - `STABLES_WEBHOOK_SECRET=whsec_…`
   - `CRON_SECRET=` a long random string
   - `SUPABASE_*` pointing at the **dev** project
   - `PAYMENT_MIN_USDC`, `PAYMENT_MAX_USDC`, `PAYMENT_MIN_USDT`, `PAYMENT_MAX_USDT` (defaults
     100 and 1000000)
2. **Database:** every migration in `supabase/migrations` applied to the dev project (the latest
   is `20260928120000_payment_swaps.sql`).
3. **Admin role:** your user has a row in `user_roles` with `role = 'admin'` (needed for step 5
   and the admin checks).
4. **Dev server and tunnel:** `cloudflared` installed (`winget install --id Cloudflare.cloudflared`,
   then a new terminal).
   ```sh
   npm run dev      # http://localhost:8080; restart it after any .env change
   npm run tunnel   # prints https://<random>.trycloudflare.com (changes on every restart)
   ```
   Check: `curl -i -X POST https://<random>.trycloudflare.com/api/public/stables-webhook` → **401**
   (not 404, not 403).
5. **Webhook endpoint:** Stables dashboard → Settings → Webhooks → add
   `https://<random>.trycloudflare.com/api/public/stables-webhook` with these events:
   - `customer.created`
   - `customer.updated`
   - `kyc_link.updated.status_transitioned`
   - `transfer.updated.status_transitioned`
   - `travel_rule.wallet_verification_required`

   Its `whsec_…` secret must equal `STABLES_WEBHOOK_SECRET`. Use the endpoint's **Testing** tab:
   every event should show **200** in the delivery log.

   Only this dashboard endpoint delivers. On 2026-09-27 two API-managed subscriptions
   (`POST /api/v1/webhooks`) on this tenant received **no** deliveries over 30+ minutes that
   covered customer creation, KYC approval and a transfer running to `completed`
   (`GET /api/v1/webhooks/deliveries` stayed empty). The app accepts Svix only anyway.

Useful SQL (Supabase SQL editor, dev project):

```sql
-- Latest payments
select id, status, source_currency, source_amount_minor, transfer_id,
       travel_rule_requested_at, travel_rule_resolved_at, actual_payout_minor
from payments order by created_at desc limit 5;

-- One payment's timeline
select created_at, kind, from_status, to_status, source, detail
from payment_events where payment_id = '<payment id>' order by id;

-- Latest webhook deliveries
select received_at, event_type, event_object_id, processed_at, process_error
from stables_webhook_events order by received_at desc limit 20;
```

## 1. Customer and KYC

**Do:** sign in, open `/pay`, choose an amount (at least 100), USDC or USDT, a country and a
currency, then **Start payment**. In the identity card, **Verify with Stables** and complete the
sandbox KYC on the hosted Sumsub page (`in.sumsub.com/websdk/p/sbx_…`).

**Sandbox KYC data:** Stables auto-approves individuals who submit Sumsub's test templates
([Stables: sandbox test documents](https://docs.stables.money/get-started/getting-started/quickstart/setup-a-sandbox-environment/sandbox-test-documents.md),
images on [Sumsub's templates page](https://docs.sumsub.com/docs/verification-document-templates)).
Upload them exactly as downloaded. The Germany templates are one person: **Freya Krause**, born
**24.03.1982**, German, Heidestrasse 19, 51247 Köln. Use that name in the identity card. Any photo
of the ID-card face works as the selfie.

What was verified on 2026-09-27:
- **Hosted-link customer** (the app's path): a customer created by `POST /customer/verification/link`
  completes `individual_base` only on the hosted page. Documents added later with
  `PATCH /customer/{id}` land on the step-up levels (`individual_passport`,
  `individual_proof_of_address`) and leave `individual_base` `in_progress`.
- **Customer created with all base data** (`POST /api/v1/customer` with name, dob, nationality,
  address, email, the Germany ID card front and back, and a selfie, requesting `base_payout`):
  `individual_base` `approved` and `base_payout` `approved` / `ready` about 15 seconds later
  (`submitted/under_review` → `submitted/provisioning` → `approved/ready`).
- **Existing customer:** when the user's Stables customer already exists (same
  `external_customer_id`), Stables answers 409 to the app's create call. The app finds it with
  `GET /customers`, adopts it (log: `adopted existing customer …`), and reports it approved
  with no new KYC link. New payments for that user start at `KYC_APPROVED`.

**Check:**
- **New payment:** status `PAYMENT_CREATED`. A preview quote priced the destination. If Stables
  refuses the destination you see "… are not supported" plus "Stables says: …"; if it refuses the
  amount, "Stables can't accept …" plus its reason.
- **Customer and webhooks:** a `stables_customers` row exists. Deliveries of `customer.created`,
  `customer.updated` and `kyc_link.updated.status_transitioned` arrive, each with `processed_at`
  set.
- **Approval:** after approval the payment is `KYC_APPROVED`. The identity card reads "Verified by
  Stables as <name>", and `stables_customers.first_name` / `last_name` are set.
- **No name:** if Stables holds no name, the bank form will refuse to continue. That is a
  question for Stables (see the end).

## 1b. Settlement coin (wallet balances)

**Do:** on `/pay`, choose "Pay with: Automatic" (or a coin) and optionally connect Phantom or
Solflare before **Start payment**. Connecting shares only the public address.

**Check:**
- **Every coin is priced:** Stables gets one preview per coin within our limits. The payment's
  timeline gets a `settlement_selected` event with each coin's verdict, the wallet's real
  mainnet balances (or "unavailable", never zero) and the choice.
- **The choice:**
  - a coin the wallet holds in full, with the better payout winning, is `funds_ready`;
  - without a wallet the choice is `tentative`;
  - with a wallet that holds neither coin it is `swap_required` (or `insufficient_funds` /
    `needs_sol`).
- **Settlement card:** shows this, with **Check my wallet again**, which works only before the
  quote and any swap, at most once every 5 seconds.
- **Sandbox:** the quote is allowed even when the choice is tentative, and the quote event records
  `readiness_enforced: false`. In production the quote needs `funds_ready`.
- **Swaps are refused in the sandbox** (`409 sandbox_swap_disabled`). Jupiter is mainnet-only,
  and the swap and funding legs belong to the real-money test.

## 2. Quote

**Do:** **Get quote**.

**Check:**
- **Status:** `QUOTED`, with a countdown ("Quote valid for m:ss").
- **Rate and fees:** the rate reads `1 USDC = …` (or `1 USDT = …`), and the fees are listed.
- **Timeline:** a `transition` to `QUOTED` with the `quote_id`.
- **Expiry:** sandbox quotes live 5 minutes. Creating the transfer after that answers 409
  `quote_expired`; **Refresh quote** gets a new one.

**Routes the sandbox priced on 2026-09-27** (100 of each coin on Solana, `preview: true`). This
is a snapshot, not a list the app uses:

| Destination | USDC (Solana) | USDT (Solana) |
| --- | --- | --- |
| GB / GBP | priced (74.44) | priced (74.44) |
| AU / AUD | priced (143.64) | priced (143.64) |
| NG / NGN | priced | priced |
| US / USD | priced (94.75) | `ROUTING_ROUTE_NOT_CONFIGURED` |
| DE / EUR | `ROUTING_ROUTE_DISABLED` | `ROUTING_ROUTE_DISABLED` |
| IN / INR, PH / PHP | `ROUTING_QUOTE_FAILED` | `ROUTING_ROUTE_NOT_CONFIGURED` |

Fees came back in `usd` (total 1.25 for GBP: platform 0.25 and payment method 1.00;
`integrator_fee` 0). `ROUTING_QUOTE_FAILED` was sometimes transient (GB/GBP failed once, then priced)
and sometimes persistent (INR and PHP at every amount). Stables applies no minimum or maximum of
its own at these amounts: 99 and 1,000,001 USDC both priced, so only LamportPay's limits apply.

## 3. Transfer to your own account

**Do:** the account holder field shows your verified name and cannot be edited. Enter the bank
name and the account number or IBAN, then **Review payment**. Check the summary, then **Confirm
and create transfer**.

**Check:**
- **Form:** it shows "Payouts can only be sent to a bank account in your own name." Date of birth
  and address appear only if Stables asks for them.
- **Summary:** it lists your name, the payment ID, the amount sent, the rate, the LamportPay fee
  (Stables' `integrator_fee`, "None" if not configured), each Stables fee, the amount your bank
  receives, the currency, the account holder, the **full** account number, the bank and the
  country.
- **Fields Stables asks for:** GB / GBP needs the account number, the sort code (under "More bank
  details") **and your address**. Without the address, `/payment-methods/validate` answers
  "address is required for BANK GBP transfers" and the form marks it.
- **After confirming:** status `CREATED` (the sandbox transfer stays `created` until the deposit).
  The **sandbox does not return a real address**: `source_deposit_instructions.wallet_address` is a
  placeholder such as `sandbox:solana:45d790d05dc156bfb0e095e5a52f528c`, with the real coin,
  network and amount. The app checks the coin, network and amount, stores the placeholder only as
  `sandbox_deposit_reference` in the timeline, and shows no deposit card. In production a
  non-Solana address is refused and recorded as the payment's `failure_reason`.
- **Database:** `payments.transfer_id` is set. `beneficiary_summary` has
  `"own_account": true`, your name, and the account masked (`••••1234`).
- **Refusals:** a Stables refusal of the amount (its limits are checked again at this step) shows
  "Stables can't accept …" plus its reason. A refusal of the bank details takes you back to the
  form with the fields marked.

## 4. Simulate the deposit (admin)

**Do:** open `/admin` → Stables payments → click the payment → **Simulate deposit**.

**Check:**
- **Toast:** "Deposit simulated (<status>)". The timeline shows `sandbox deposit simulated` with
  the `simulation_id`.
- **Guards:** the button only shows in the sandbox and only while the transfer waits for funds
  (`CREATED` or `AWAITING_FUNDS_COLLECTION`). The server refuses a live (`sti_live_`) key or a
  production URL even if called directly, and refuses non-admins ("Admin role required.").
- **Observed 2026-09-27:** the simulation answered scenario `completed`, and the Stables transfer went
  `created` → `in_progress` → `completed` within about 10 seconds.
- **Repeats:** a second click replays the same simulation; one key per transfer.

## 5. Webhooks → COMPLETED

**Check:**
- **Webhooks:** `transfer.updated.status_transitioned` deliveries arrive. The payment moves
  forward (`FUNDS_COLLECTED` → … → `COMPLETED`) and each step appears on `/pay` within about 5
  seconds.
- **Real payloads (observed 2026-09-28):**
  - `transfer.*` events carry a thin `event_object`: `transfer_id`, `customer_id`, `type` (`TRANSFER_TYPE_OFFRAMP`),
    an upper-case `status` and timestamps. There is no `metadata` and no `actual_payout`.
  - `transfer.created` arrived within about 2 seconds of creation.
  - `kyc_link.updated.status_transitioned` has `event_object_id` = the KYC link, plus
    `customer_id` and **`kyc_level`**. It fires for step-up levels too
    (`INDIVIDUAL_PROOF_OF_ADDRESS` → `VERIFICATION_APPROVED` for a customer whose base KYC was
    still in progress). The app re-reads the customer for every such event and only trusts the
    event's own status for `INDIVIDUAL_BASE`.
  - `customer.created` carries the name, email, `external_customer_id` and
    `customer_type` (`CUSTOMER_TYPE_INDIVIDUAL`).
  - On 2026-09-28 **no real `transfer.updated.status_transitioned` arrived** for three transfers
    that went to `completed` (`75292f42-…`, `3dbeb6c1-…`, `50c05d8f-…` at 21:24:51 UTC). Their
    `transfer.created` did arrive, and so did the dashboard's example of that event type. The
    recover-failed replay of the previous day brought none either. Until Stables sends it,
    reconciliation is what moves payments past `CREATED`.
- **Delivery log:** each accepted delivery logs
  `{"event":"stables_webhook_received","svix_id":…,"event_id":…,"claim":…}`, which ties the dashboard's
  message ID to our `event_id`. `claim` is `new`, `retry` (stored before but unprocessed) or
  `duplicate` (already applied; answered 200 and skipped).
- **Missed webhooks:** if a step seems stuck, `npm run reconcile` pulls the latest transfer status
  from Stables and replays stored deliveries that never applied. It prints a report. Without a
  working dashboard endpoint this is the only way forward: on 2026-09-27 it moved a payment
  `CREATED` → `COMPLETED` in one step (`source: reconcile`, `stables_at` = Stables' completion time).
  In production the cron runs once a day by default (`RECONCILE_CRON_SCHEDULE`, `0 5 * * *`), so
  webhooks must work there.
- **Settled payout:** on `COMPLETED`, `actual_payout_minor` / `_currency` are recorded (from the
  event or `GET /transfers/{id}`), and the timeline shows `payout settled`. **The sandbox sends no
  `actual_payout`** (absent from `GET /transfers/{id}` after `completed`), so sandbox receipts show
  the quoted amount, and reconciliation keeps re-checking completed payments for 14 days.
- **Sandbox stops early:** if the sandbox never reaches `COMPLETED` after a simulated deposit,
  that is sandbox behaviour to raise with Stables. To see the receipt locally anyway, run
  `npm run webhook:send -- transfer <transfer_id> COMPLETED` (it moves the local record only).

## 6. Travel Rule step

The sandbox does not raise a Travel Rule hold by itself. Send one locally with `npm run
webhook:send` (signed with `STABLES_WEBHOOK_SECRET`) while the payment waits for funds, before
step 4:

```sh
npm run webhook:send -- travel-rule <transfer_id>
```

**Check:**
- **User side:** `/pay` shows "Action needed — verify your wallet" and the verification card with
  a countdown and the **Verify wallet with Stables** button.
- **Admin side:** `/admin` lists the payment under "Travel Rule: waiting on wallet verification".
- **Logs:** the dev server logs `{"event":"travel_rule_reference", "transaction_reference_id":
  …, "matched_by": "transfer_id", …}`. **Keep this line from the first real event:** it shows
  which ID Stables uses.
- **Release:** after the next transfer step (step 4/5, or `npm run webhook:send -- transfer
  <transfer_id> FUNDS_COLLECTED`), the card disappears. The timeline shows "Wallet verification
  done", and admin shows "Hold lifted".
- **Other cases:**
  - `--expires-in 1`: after a minute the card says the link expired.
  - `travel-rule no-such-reference`: listed under "Requests with no matching payment".

## 7. Receipt

**Do:** on the completed payment, **View receipt**, or `/payments` → Receipt.

**Check:**
- **Contents:** the same rows as the summary, plus the status, created and completed times, the
  Stables transfer ID, and the Solana transaction. For a simulated deposit that shows "Simulated
  deposit (Stables sandbox)". The account number is masked (`••••1234`); the full number is never
  stored.
- **History:** `/payments` lists the payment with a Receipt link.
- **Admin:** `/admin/stables/<payment id>` shows the same receipt plus the owner, the wallet, and
  the timeline with details.
- **Print:** "Print / save as PDF" hides the page chrome.

## 8. Other checks

- **Our limits:**
  - 14.99 USDC is refused: "Payments must be between 15 and 1,000,000 USDC." (LIVE defaults;
    TEST MODE reads "between 15 and 5,000 USDC").
  - Change `PAYMENT_MIN_USDT` in `.env` and restart: the USDT limit follows.
- **Unknown events:** `npm run webhook:send -- unknown` gives 200, stored as "Ignored
  virtual_account.created."
- **Wrong amounts:** the sandbox cannot produce them. See `docs/wrong-amount-deposits.md`.

## Automated checks

- `npm test` runs the unit tests and the HTTP e2e tests against the running dev server.
- The signed-in Jupiter e2e checks run only with `E2E_ACCESS_TOKEN` set to a dev-project user's
  access token. Without it they are skipped, and the suite says so.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| 403 "This host is not allowed" | Start the tunnel with `npm run tunnel` (it sets the host header). |
| 404 on the webhook URL | The path is `/api/public/stables-webhook`. |
| 401 "Invalid webhook signature." | The secret is not this endpoint's (copied from another endpoint, or rotated). |
| 401 "…outside the allowed window." | The local clock is more than 5 minutes off. |
| 503 on webhooks | The secret is not loaded: set it and restart `npm run dev`. |
| `npm run reconcile` → 401 | The server's `CRON_SECRET` differs: restart `npm run dev` after editing `.env`. |
| Bank form: "no name from your verified profile" | Stables' customer record has no first/last name; ask Stables. |
| Deliveries time out or fail with no response | The tunnel stopped or its URL changed: restart it and update the endpoint, then reload the dashboard page to check the new URL saved. A quick tunnel does not survive the machine sleeping, and each restart gets a new hostname. A named Cloudflare tunnel with a fixed hostname avoids this. |
| "could not price this payment…" | Stables answered `ROUTING_QUOTE_FAILED`. Retry; if it persists (INR, PHP on 2026-09-27) the route is not available. |
| Transfer: 502 "payout partner is unavailable" | Stables answered 5xx (the dev log shows `[stables] request failed 500 …`). Nothing is created; retry later, or ask Stables. On 2026-09-27, GB / GBP transfers answered 500 "Something went wrong while creating the transfer." from 14:03 UTC, for USDC and USDT and every customer. They were intermittent from 14:47: one USDC transfer succeeded at 14:47:33, then both coins failed at 14:48. AU / AUD transfers succeeded at 14:48 (USDT) and 14:50–14:58 (USDT and USDC through the app). A new customer's `base_payout` also stayed in `provisioning`, and `/health` said healthy throughout. |
| Payment: 502 and the dev log shows `request failed 0 Could not reach Stables.` | A network connect timeout from this machine to the sandbox (seen twice on 2026-09-27). Retry. |
| Stables says it delivered, but nothing is stored | A signed delivery the app refuses (wrong or rotated secret, clock skew) is logged as `[stables-webhook] refused <svix-id>: <reason>`. If that line is absent too, the request never reached the app. |
| `npm run build`: `EISDIR … readlink` | The repo is on an exFAT drive (E: here); Nitro's file tracing fails there. Build from an NTFS drive or rely on the Vercel build. |

## Questions for Stables

- How does the customer record get `first_name` / `last_name`, and are they the names verified
  during KYC? We lock payouts to that name, as the docs require. (In the sandbox the record keeps
  the name sent at creation.)
- **USDT on Solana:** it quotes (GBP, AUD, NGN on 2026-09-27; not USD). A USDT → AUD transfer ran
  to `completed` in the sandbox (simulated deposit). USDT → GBP could not be created because of the
  500s below. Real funding with USDT is untested (sandbox-limited).
- **GBP transfer creation 500s** (tenant `9337824d-1860-4ac5-a352-88416f59085b`): from about 14:03
  UTC on 2026-09-27, `POST /api/v1/transfer` to GB / GBP answered 500 "Something went wrong while
  creating the transfer." for USDC and USDT. One call succeeded at 14:47:33, then it failed again
  at 14:48; AUD transfers worked at the same time. Correlation IDs: `d39b1358-e405-4f83-83ca-0749b04d7f31`
  (USDT, 14:48:37), `b38a38fd-7ff9-476d-bacd-0acfc13d3399` (USDC, 14:48:45); a success for comparison:
  `993eafd6-16ca-4fe0-86ed-2e18deef9745` (USDC, 14:47:33). A new customer's `base_payout` also stayed in
  `provisioning` for 20+ minutes. What failed, and is it fixed?
- **API-managed webhook subscriptions** (`POST /api/v1/webhooks`) got no deliveries on this
  tenant. Should the API refuse them for a dashboard-managed tenant?

Resolved on 2026-09-28: the dashboard endpoint *was* delivering (141+ attempts across all event
types), but to an old quick-tunnel host that no longer existed. The URL edit of 2026-09-27 had not
saved. Webhooks were never refused by LamportPay.
- **`actual_payout`:** absent from `GET /transfers/{id}` after `completed` in the sandbox. Is it
  populated in production, and on which event?
- **Deposit address:** the sandbox returns `sandbox:solana:<hex>`. Confirm that production always
  returns a real Solana address for Solana deposits, and whether it expires.
- **List vs detail:** `GET /customers` reports a pending `base_payout` as `submitted`, while
  `GET /customers/{id}` says `pending`. Which is authoritative? (The app's 409 recovery reads the
  list.)
- **`ROUTING_QUOTE_FAILED`:** is it ever a final answer (INR and PHP failed at every amount), or
  always transient?
- Travel Rule:
  - Which ID is `transaction_reference_id`?
  - Does the hold apply to off-ramp deposits from self-custody wallets?
  - Is there a "verified" event?
- Wrong-amount deposits: see `docs/wrong-amount-deposits.md`.

Answered on 2026-09-27: after a simulated deposit the sandbox **does** run the transfer to
`completed` (about 10 seconds).

## Stables fees and rate (sandbox check, 30 Sep 2026)

Checked with `node scripts/stables-fee-probe.mjs` (sandbox only; preview quotes, nothing created):

| Sent | To | Stables fees | Stables payout | `exchange_rate` |
|---|---|---|---|---|
| 100 USDC | INR | 0.25 platform + 5.00 payment method = 5.25 USD | 8,709.43 INR | 87.0943 |
| 98 USDC | INR | 0.245 + 5.00 = 5.245 USD | 8,525.59 INR | 86.9958 |
| 1,000 USDC | INR | 2.50 + 5.00 = 7.50 USD | 91,230.71 INR | 91.2307 |
| 100 USDC | USD | 0.25 + 5.00 = 5.25 USD | 94.75 USD | 0.9475 |
| 100 USDC | GBP | 0.25 + 1.00 = 1.25 USD | 74.33 GBP | 0.7433 |

What this shows:
- Stables' **platform fee is 0.25%** of the amount it converts; **payment-method fee is fixed per
  corridor** (INR 5, USD 5, GBP 1 USD; AUD 0 in earlier quotes); fx and integrator fees 0.
- Stables' fees are **already taken out of the payout**: USD 100 → 94.75 = 100 − 5.25, and INR
  gives the same underlying rate at every size ((100 − 5.25) × 91.92 ≈ 8,709; (1,000 − 7.5) × 91.92 ≈ 91,231).
- `exchange_rate` = payout ÷ amount sent, i.e. an **effective rate after Stables' fees** (it
  rises with the amount because the fixed fee weighs less). The Stables dashboard's "1 USDC =
  87.0943 INR · indicative" is this same number. `/pay` labels it "Effective rate, after partner fees".
- LamportPay's 2% is separate: on 100 USDC sent, 2.00 goes to LamportPay and 98 to Stables, so
  the payout is Stables' quote for 98 (8,525.59 INR in this check), not for 100.
- Sandbox prices are "not reflective of live pricing" (Stables' own banner). Production fees and
  rates must be re-checked in the real-money test.

## Sandbox transfer status and webhooks (observed 27 Sep – 3 Oct 2026)

What Stables itself reports, read with `node scripts/stables-transfer-status.mjs <transfer_id>`
(sandbox only, read-only, prints status and timestamps, never the key):

| Payment | Corridor | Amount sent to Stables | Deposit simulated | Stables status | Stables `updated_at` |
|---|---|---|---|---|---|
| 8f05eb6e (and b6601115, 93e94178, 12cf1f2e) | USDC → AUD | 105–150 USDC | 27 Sep | **completed** | 26 s after creation |
| 4a46aa71, c25131bb | USDC → GBP | 100 USDC | 26–27 Sep | **completed** | within a minute |
| bf3c85c2 | USDC → NGN | 9.80 USDC | 2 Oct 02:24 UTC (admin) | **in_progress** | 2 Oct 02:24 (no change since) |
| b81a858e | USDC → BRL | 49 USDC | 2 Oct (admin) | **in_progress** | 2 Oct 02:54 (no change since) |
| fe62b23e | USDC → NGN | 9.80 USDC | 2 Oct 23:02 UTC (TEST Pay Now) | **in_progress** | 2 Oct 23:02 (no change since) |
| c7310839 (new user) | USDC → NGN | 9.80 USDC | 3 Oct 00:01 UTC (TEST Pay Now) | **in_progress** | 3 Oct 00:01 |
| 1ac88bef (new user) | USDC → GBP | — | — | transfer creation **500** ("Something went wrong while creating the transfer", correlation id `fce3764e-42e7-4ad5-8db9-d66ccd9be722`) | — |

### Controlled experiment, 3 Oct 2026 00:19–00:24 UTC (Stables sandbox only, LamportPay bypassed)

`node --use-env-proxy scripts/stables-sandbox-lifecycle-probe.mjs <customer_id> CUR:AMOUNT …` creates
a quote and a transfer for one already-verified sandbox customer (`c97c3e6e…`, approved), calls
Stables' `POST /transfers/{id}/sandbox/simulate-deposit` (no body; Stables answers 202
`deposit_status: completed`), then polls `GET /transfers/{id}`. Same request shape and purpose code
(`TRANSFER_TO_OWN_ACCOUNT`) for every case; only corridor and amount change.

| Case (amount to Stables) | Transfer creation | Statuses Stables reported |
|---|---|---|
| GBP 100 | 201 (c1ad2e55…) | `created` → **`completed`** within 1 s |
| NGN 9.8 | 201 (0773a58e…) | `created` → `awaiting_funds_collection` → **`in_progress`** (no change after minutes) |
| NGN 105 | 201 (7e60376f…) | `created` → **`in_progress`** (no change) |
| NGN 500 | 201 (1cce5c7a…) | `created` → `awaiting_funds_collection` → **`in_progress`** |
| MXN 100 | 201 (89e37b44…) | **`in_progress`** (no change) |
| KES 100 | 201 (73d35785…) | **`in_progress`** (no change) |
| GBP 19.6, GBP 50 | **500** "Something went wrong while creating the transfer" (correlation ids `115860de-bd20-4e9b-9890-0c6d788a8e09`, `c8dd3e1b-382b-4802-a1ca-2e514da1ae76`) | — |
| AUD 105 | quote **422** "No route is currently available for this transfer" | — (AUD completed on 27 Sep) |

A sanitized side-by-side of a completed (AUD, 27 Sep) and a stuck (NGN, 3 Oct) transfer
(`scripts/stables-transfer-compare.mjs`) shows the same structure: `type: offramp`, `origin: api`,
`funding_source: fund_transfer`, same fee fields; only currency, amount, bank fields and status differ.

Follow-up the same night (00:40–00:55 UTC):
- **GBP transfer creation depends on the amount sent to Stables.** Same customer, same body, only
  the amount changed: 60, 80, 100, 120, 140 and 200 USDC → created (and `completed` after the
  simulated deposit); 50, 100.5, 100.94, 101, 105, 110, 130 and 150 → **500** "Something went
  wrong while creating the transfer" (repeatable). It looks like the sandbox only accepts GBP amounts
  that are multiples of 20. LamportPay's 2% comes out of what the user sends, so a 103 USDC payment
  sends 100.94 to Stables and hits the 500.
- **End to end through LamportPay → COMPLETED (3 Oct 00:52 UTC):** payment `771ad2e1`, verified new
  user (wallet BUGA…m4dM), the user sends 102.040817 USDC (exactly 100.00 to Stables), GBP. Payout
  details checked; transfer `043ae1d9…` created; the owner approved the devnet memo transaction;
  `test_payment_detected` → `sandbox_deposit_simulated`; Stables reported `completed`;
  `npm run reconcile` moved the payment `CREATED → COMPLETED` (source `reconcile`); `/pay` shows
  "Completed — paid into your account" with devnet explorer links.
- **Webhooks:** the Stables dashboard (Settings → Webhooks → Logs) lists only `transfer.created`
  messages for these transfers, including the ones that reached `completed`. The sandbox did **not
  emit** `transfer.updated.status_transitioned` at all, so no webhook could have moved them. The one
  registered endpoint still points at an old cloudflared quick tunnel (error rate ~90%), so on DEV
  even `transfer.created` is not delivered. Reconciliation was therefore required in the sandbox; since 3 Oct the running app does it by
  itself (live status sync, below), so `npm run reconcile` is no longer needed for a payment to progress. Production behaviour: ask Stables (E1).

**Verdict:** `IN_PROGRESS → COMPLETED` is decided by Stables' sandbox per corridor, not by
LamportPay: after the simulated deposit the sandbox completes GBP (≥ 100) and previously AUD, and
leaves NGN, MXN and KES (and BRL) in `in_progress`. LamportPay mirrors exactly what
`GET /transfers/{id}` returns. GBP transfers below ~100 fail inside Stables with a 500.

What Stables needs to do / answer:
1. Make sandbox NGN / MXN / KES / BRL transfers progress to `completed` (or `failed`) after
   `simulate-deposit`, or document the sandbox control that does.
2. Fix the GBP `POST /transfer` 500 for amounts that are not multiples of 20 USDC (or return a 4xx
   with the real reason).
3. Say whether AUD was removed from the sandbox on purpose.

Conclusions (facts, not assumptions):
- LamportPay's status follows Stables: our `IN_PROGRESS` is Stables' `in_progress`. Nothing in
  LamportPay holds these payments back; `npm run reconcile` re-reads them and finds no change.
- In the sandbox, NGN and BRL transfers have not left `in_progress` for 20+ hours after the
  simulated deposit, while AUD and GBP transfers reached `completed` within a minute. Whether the
  sandbox completes NGN/BRL at all, or only some corridors/amounts, is **OPEN — ask Stables**.
- `actual_payout` is absent in the sandbox even after `completed` (see section 5).
- Small amounts: the sandbox refuses to quote IN, US and PH at 10 USDC ("cannot be quoted for this
  route") and AUD at 20 USDC ("No route is currently available"); GB, NG and MX quote at 10.

Webhooks:
- Localhost cannot receive webhooks (Stables needs a public HTTPS URL). Use `npm run tunnel` and
  register the tunnel URL on the Stables dashboard endpoint (section 0), or run `npm run reconcile`.
- Earlier tunnel tests (26–27 Sep, section 5) received `transfer.created` from the sandbox but
  no `transfer.updated.status_transitioned`; API-managed subscriptions delivered nothing. (Eight
  `transfer.updated.status_transitioned` deliveries are stored for 26 Sep 18:51, 2–3 s apart; their
  origin — Stables or our own `npm run webhook:send` test tool — cannot be told from the database,
  so they are not counted as evidence of sandbox delivery.) No tunnel was running for the 2–3 Oct payments, so webhook delivery
  was not re-tested for them.
  Until Stables confirms the sandbox behaviour (E1 in `docs/ROADMAP.md`), reconciliation is what
  moves payments past `CREATED` on DEV. Production must not rely on the daily cron alone.

Questions for Stables (add to the list above):
1. Does the sandbox progress NGN / BRL transfers to `completed` after `simulate-deposit`? If so,
   after how long, and is there a sandbox control to force `completed` or `failed`?
2. Does the sandbox send `transfer.updated.status_transitioned` for every transition, or only some?
3. Is `actual_payout` populated in production on `completed`?
4. Why does `POST /api/v1/transfer` answer 500 for GBP amounts that are not multiples of 20 USDC
   (correlation ids `fce3764e-42e7-4ad5-8db9-d66ccd9be722`, `5efdad17-ffb4-46e1-bf59-73964a72d4a6`,
   `9c932936-5923-4a6b-a261-f52629d5778c`, 3 Oct 2026)?
5. Does the sandbox ever emit `transfer.updated.status_transitioned`? Its message log shows only
   `transfer.created`, even for transfers that reached `completed`.

## Live status sync (3 Oct 2026) — no reconcile command needed

Root cause of payments "stuck" until `npm run reconcile`: the app only changed a payment's status
from a webhook or from the reconciliation job. The sandbox sends no status webhooks (and a local app
cannot receive any), and the job runs daily (Vercel cron) or by hand. The payment screen polled our
database every 5 s, but nothing refreshed the database from Stables.

Fix: `syncPaymentWithStables` (src/lib/payments/service.server.ts). Whenever a payment with an open
transfer is viewed — the user's `/pay` screen (polling every 5 s, also in a background tab), the
admin payment list (polling every 15 s) and the admin payment detail (every 5 s) — the server reads
`GET /transfers/{id}` from Stables, at most once per 8 s per payment, and applies the status with
the same forward-only rules as reconciliation (event source `reconcile`, `trigger: live_sync`).
A simulated sandbox deposit (TEST Pay Now or Admin → Simulate deposit) is followed by an immediate
sync. Stables' status is the only input: `in_progress` stays `IN_PROGRESS`; `completed` becomes
`COMPLETED` within one poll. A Stables error keeps the stored state.

GHS check (3 Oct, payment 4734c7e2, transfer edacbe54…, 102.9 USDC to Stables): Stables itself
reports `in_progress` since 01:31 UTC, so GHS joins NGN/MXN/KES/BRL as a sandbox corridor that does
not complete. LamportPay shows "Processing" for it, correctly.

## Full corridor matrix (3 Oct 2026)

See `docs/testing/stables-sandbox-matrix-2026-10-03.md`. Sandbox completes GBP (multiples of 20 USDC only), INR, PHP and USD; ARS, BRL, COP, GHS, KES, MXN, NGN, RWF, TZS, UGX, XAF, XOF, ZAR and ZMW stay `in_progress`; AUD has no route; INR/USD/PHP refuse 10 USDC quotes.
