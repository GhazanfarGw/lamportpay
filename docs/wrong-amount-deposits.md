# Wrong-amount deposits: what LamportPay does today

Status: documented behaviour, no refund flow. What Stables does with a wrong deposit is an open
question with Stables (see the end).

## Where a wrong amount can come from

- **The in-app "Send" button cannot send a wrong amount.** The server builds the transaction from
  the stored deposit instructions: exact amount, exact token (USDC or USDT), exact deposit
  address. The wallet only signs it.
- **A manual send can.** A user who copies the deposit address and sends from a wallet app or an
  exchange can send too much, too little, in two parts, or from a different wallet.

## What our code does

A manual send is checked when the user submits its transaction signature ("Sent it from another
wallet?"). The check (`verifyFunding` → `verifyUsdcDeposit`) requires one finalized Solana
transaction in which the payer wallet sent **exactly** the deposit amount of the payment's token,
and the deposit address received exactly that.

| Case | Our check | Payment state | User sees | Admin sees |
| --- | --- | --- | --- | --- |
| Over-payment (e.g. 150.5 for 150) | Rejected | Unchanged | Error with both amounts, then a "Do not send again" warning | "Deposit mismatch" badge, banner on the payment page, timeline detail |
| Under-payment | Rejected | Unchanged | Same | Same |
| Two partial sends | Each rejected (neither matches) | Unchanged | Warning after the first | Same |
| Right amount, wrong wallet | Rejected ("not signed by your wallet") | Unchanged | Same warning (funds did move) | Same |
| Transaction failed on-chain | Rejected, nothing moved | Unchanged | Error only; retrying is safe | Timeline entry, no badge |

Details:

- **Event:** each rejection writes a `funding_rejected` timeline event with the signature, the
  payer, the reason, and `received_minor` / `expected_minor`. A positive `received_minor` means
  funds reached Stables' deposit address.
- **Warning:** when the latest rejection moved funds and no deposit has been verified, the payment
  page replaces the send controls with: "We could not accept your deposit… **Do not send again.**
  Stables decides what happens to the funds it received…". The send button and the swap panel
  are hidden, so the page no longer invites a second payment.
- **No funding evidence:** `funding_signature` stays empty. The receipt shows no Solana
  transaction for such a payment.

## The state follows Stables, not our check

Our check never moves the payment. The payment state is Stables' transfer state, driven by
webhooks and the reconciliation job (`npm run reconcile`). Whatever Stables does with the funds
it received shows up there:

- **It collects and pays out:** the payment moves on to `COMPLETED`. `actual_payout` records what
  the bank really received, and the receipt shows that amount.
- **It holds the transfer:** `COMPLIANCE_HOLD`.
- **It gives up:** `FAILED`, `CANCELLED` or `EXPIRED` (terminal).

## What we do not do

- No refunds, no automatic re-quote, no second deposit address.
- No summing of partial deposits.
- Admins resolve cases with Stables using the Stables transfer ID from the admin payment page
  (`/admin/stables/<payment id>`).

## Testing

- The sandbox cannot produce a wrong amount. `POST /transfers/{id}/sandbox/simulate-deposit`
  takes no amount and always simulates the exact deposit.
- The rejection path is covered by unit tests (`tests/payments-service.unit.test.ts`, "deposit
  verification").
- A real wrong-amount case needs production and real funds.

## Questions for Stables

1. **Over-payment:** paid out in full, paid out as quoted with the rest held, or refunded?
2. **Under-payment:** held until topped up, paid out pro rata, or failed? Is a top-up to the same
   address added to the first deposit?
3. **Refunds:** where do they go? To the sending self-custody wallet? With Travel Rule
   verification first?
4. **Status:** which transfer status and which webhook show each case? Is there a field with the
   amount actually received?
5. **After expiry:** what happens to a deposit sent to an expired transfer's address?
