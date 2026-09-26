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
   is `20260926200000_usdt_source.sql`).
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
sandbox KYC.

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

## 2. Quote

**Do:** **Get quote**.

**Check:**
- **Status:** `QUOTED`, with a countdown ("Quote valid for m:ss").
- **Rate and fees:** the rate reads `1 USDC = …` (or `1 USDT = …`), and the fees are listed.
- **Timeline:** a `transition` to `QUOTED` with the `quote_id`.

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
- **After confirming:** status `AWAITING_FUNDS_COLLECTION` (or `CREATED`), with a deposit address
  for the chosen coin.
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
- **Guards:** the button only shows in the sandbox and only while the transfer waits for funds.
  The server refuses a live (`sti_live_`) key or a production URL even if called directly.
- **Repeats:** a second click replays the same simulation; one key per transfer.

## 5. Webhooks → COMPLETED

**Check:**
- **Webhooks:** `transfer.updated.status_transitioned` deliveries arrive. The payment moves
  forward (`FUNDS_COLLECTED` → … → `COMPLETED`) and each step appears on `/pay` within about 5
  seconds.
- **Missed webhooks:** if a step seems stuck, `npm run reconcile` pulls the latest transfer status
  from Stables and replays stored deliveries that never applied. It prints a report.
- **Settled payout:** on `COMPLETED`, `actual_payout_minor` / `_currency` are recorded (from the
  event or `GET /transfers/{id}`), and the timeline shows `payout settled`.
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
  - 99 USDC is refused: "Payments must be between 100 and 1,000,000 USDC."
  - Change `PAYMENT_MIN_USDT` in `.env` and restart: the USDT limit follows.
- **Unknown events:** `npm run webhook:send -- unknown` gives 200, stored as "Ignored
  virtual_account.created."
- **Wrong amounts:** the sandbox cannot produce them. See `docs/wrong-amount-deposits.md`.

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
| Deliveries time out | The tunnel stopped or its URL changed: restart it and update the endpoint. |

## Questions for Stables

- How does the customer record get `first_name` / `last_name`, and are they the names verified
  during KYC? We lock payouts to that name, as the docs require.
- Can customers fund off-ramp transfers with **USDT on Solana**?
- Travel Rule:
  - Which ID is `transaction_reference_id`?
  - Does the hold apply to off-ramp deposits from self-custody wallets?
  - Is there a "verified" event?
- After a simulated deposit, does the sandbox run the transfer to `COMPLETED`?
- Wrong-amount deposits: see `docs/wrong-amount-deposits.md`.
