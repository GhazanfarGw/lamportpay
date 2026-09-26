# Stables sandbox runbook

How to receive Stables sandbox webhooks on a local dev server and exercise every event LamportPay
subscribes to, including the Travel Rule wallet-verification step.

## Prerequisites

- `.env.local` (or `.env`) has a sandbox `STABLES_API_KEY` (`sti_test_…`) and
  `STABLES_API_URL=https://api.sandbox.stables.money`.
- Supabase points at the **dev** project, with every migration in `supabase/migrations` applied,
  including `20260926170000_travel_rule.sql`. Without it the payment routes and the admin
  "Stables payments" section fail with "column … does not exist".
- `cloudflared` is installed (`winget install --id Cloudflare.cloudflared`; open a new terminal
  afterwards so it is on `PATH`).

## 1. Expose the dev server

```sh
npm run dev      # http://localhost:8080
npm run tunnel   # prints https://<random>.trycloudflare.com
```

`npm run tunnel` runs `cloudflared tunnel --url http://localhost:8080 --http-host-header localhost:8080`.
The host-header flag is required: the Vite dev server answers any other `Host` with
`403 Blocked request. This host is not allowed.`

Quick tunnels are ephemeral. The URL changes every time `cloudflared` restarts, so update the
endpoint in the Stables dashboard after each restart.

Check the route is reachable (expect **401**, not 404):

```sh
curl -i -X POST https://<random>.trycloudflare.com/api/public/stables-webhook
# HTTP/2 401 {"error":"Missing svix signature headers."}
```

## 2. Register the endpoint

1. Stables Developer Dashboard → **Settings → Webhooks → Add endpoint**.
2. URL: `https://<random>.trycloudflare.com/api/public/stables-webhook`
3. Events:
   - `customer.created`
   - `customer.updated`
   - `kyc_link.updated.status_transitioned`
   - `transfer.updated.status_transitioned`
   - `travel_rule.wallet_verification_required`
4. Copy the endpoint's signing secret (`whsec_…`) into `.env.local`:
   ```
   STABLES_WEBHOOK_SECRET=whsec_…
   ```
   `.env.local` overrides `.env`. Never commit it (`*.local` and `.env.*` are git-ignored).
5. **Restart `npm run dev`**: env files are read only at startup.

What the endpoint answers:

| Response | Meaning                                                                  |
| -------- | ------------------------------------------------------------------------ |
| 200      | Stored (by `event_id`) and processed after the response. Unknown types too. |
| 401      | No Svix headers, bad signature, or timestamp more than 5 minutes off.     |
| 503      | Signed, but `STABLES_WEBHOOK_SECRET` is not loaded. Stables retries.      |
| 500      | The event could not be stored. Stables retries.                          |

## 3. Smoke test with the dashboard's Testing tab

Send each subscribed event type from the endpoint's **Testing** tab. Every delivery should show
**200** in the dashboard's delivery log. The example payloads use IDs LamportPay does not know,
so they are stored and acknowledged, then handled as follows:

| Event                                      | Stored outcome (`stables_webhook_events`)                        |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `customer.created` / `customer.updated`    | processed, "Not a LamportPay customer."                            |
| `kyc_link.updated.status_transitioned`     | unprocessed, "Unknown customer." (retried by reconciliation)       |
| `transfer.updated.status_transitioned`     | unprocessed, "No payment for this transfer yet."                   |
| `travel_rule.wallet_verification_required` | unprocessed, "No payment matches reference txn-ref-8842."          |

The Travel Rule example also appears in **/admin → Stables payments → Requests with no matching
payment**.

```sql
select event_type, event_object_id, processed_at, process_error, received_at
from stables_webhook_events order by received_at desc limit 20;
```

## 4. Real sandbox flow

In `/pay`: create a payment, verify with Stables (sandbox KYC), get a quote, and enter the
recipient's bank details. This creates a real sandbox transfer (`payments.transfer_id`). Funding
is disabled against the sandbox, because sandbox deposit addresses are not real.

Customer and KYC webhooks from these steps arrive for real. `customer.updated` re-reads the
customer, which is how a `base_payout` entitlement granted after KYC approval moves waiting
payments to `KYC_APPROVED`.

## 5. Travel Rule wallet verification

### What it is

Stables can hold a transaction until the customer proves they own the self-custody wallet
involved (our users pay from Phantom or Solflare). The webhook carries a `verification_url`, an
`expires_at`, and a `transaction_reference_id`.

LamportPay stores these on the payment. It does not add a payment state: the Stables transfer
state stays authoritative, and the hold can overlap `AWAITING_FUNDS_COLLECTION` or
`COMPLIANCE_HOLD`.

- **User:** the payment page shows an "Action needed — verify your wallet" badge and a step card
  with the expiry countdown. The card has a button that opens Stables' page and warns never to
  enter a seed phrase. The page polls and updates by itself.
- **Admin:** /admin → Stables payments → "Travel Rule: waiting on wallet verification", with the
  reference, expiry, sending wallet, and a copy-link button.
- **Lifted:** Stables sends no "verified" event. The hold counts as lifted when a later transfer
  state (by Stables' event time) moves the transfer on: anything but `COMPLIANCE_HOLD`, `FAILED`,
  `CANCELLED` or `EXPIRED`. A payment that ends while the hold is open shows as "Ended
  unverified".
- **Matching:** `transaction_reference_id` is matched against the transfer ID, then the funding
  transaction signature, then earlier requests. Unmatched requests stay unprocessed and are
  replayed when a transfer or funding signature with that ID is stored. They are also retried by
  reconciliation for 3 days.

### Exercise it

The sandbox will not raise a Travel Rule hold by itself, because no real deposit arrives from a
self-custody wallet. Send signed events locally instead. `npm run webhook:send` signs with
`STABLES_WEBHOOK_SECRET` from `.env.local` and posts to `http://localhost:8080` (override with
`--url`).

Take `<transfer_id>` from /admin → Stables payments (shown under each payment), or from
`payments.transfer_id`.

```sh
# 1. Hold: the payment page shows the verification step; admin lists it as pending.
npm run webhook:send -- travel-rule <transfer_id>

# 2. Release: the step disappears, the timeline shows "Wallet verification done", admin shows "Hold lifted".
npm run webhook:send -- transfer <transfer_id> FUNDS_COLLECTED
```

Other cases:

```sh
# Expiry: after a minute the card says the link expired and points to /contact.
npm run webhook:send -- travel-rule <transfer_id> --expires-in 1

# A new request after a lifted one re-opens the step.
npm run webhook:send -- travel-rule <transfer_id>

# Unmatched: listed under "Requests with no matching payment".
npm run webhook:send -- travel-rule no-such-reference

# A link that is not https is never shown; the user is told to contact us.
npm run webhook:send -- travel-rule <transfer_id> --verification-url http://insecure.example

# Other subscribed and unknown types.
npm run webhook:send -- customer-updated <stables_customer_id>
npm run webhook:send -- kyc <stables_customer_id> VERIFICATION_APPROVED
npm run webhook:send -- unknown   # 200, stored as "Ignored virtual_account.created."
```

A `transfer` event moves the stored payment through the real state machine. Use it only on
sandbox payments.

To retry unprocessed deliveries now instead of waiting for the cron:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:8080/api/cron/reconcile-payments
```

### Confirm with Stables before production

- Which ID is `transaction_reference_id`: the transfer ID, the deposit transaction hash, or
  something else? The docs example (`txn-ref-8842`) does not say.
- Does the hold apply to off-ramp **deposits** from self-custody wallets? The docs say "only
  relevant for self-custody withdrawals".
- What transfer status does a held transfer show (`AWAITING_FUNDS_COLLECTION`, `COMPLIANCE_HOLD`)?
  Is there an event when verification completes or fails?
- Does an expired link get re-issued automatically (a new event), or on request?
- Can the verification page be embedded (iframe), or completed via API? Today it opens in a new
  tab, like hosted KYC.

## Troubleshooting

| Symptom                               | Fix                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| 403 "This host is not allowed"        | Start the tunnel with `npm run tunnel` (it sets the host header).              |
| 404                                   | Wrong path: it is `/api/public/stables-webhook`.                              |
| 401 "Invalid webhook signature."      | Secret does not match this endpoint (copied from another endpoint, or rotated). |
| 401 "…outside the allowed window."    | Local clock is more than 5 minutes off.                                      |
| 503                                   | Secret not loaded: set it in `.env.local` and restart `npm run dev`.          |
| Delivery log shows timeouts           | The tunnel stopped or its URL changed: restart it and update the endpoint.     |
