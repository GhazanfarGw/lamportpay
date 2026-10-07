# Wallet-less (QR / copy-address) payment — design only

Status: DESIGN, not implemented (checklist item 11). The connected-wallet flow stays the main
flow. Nothing here changes custody: funds always go from the user's own wallet or exchange
straight to the Stables deposit address of one transfer.

## What the user would see

1. Verified user (KYC passed) gets a quote and confirms bank details, exactly as today.
2. Instead of "Pay with wallet", they choose "Pay from another wallet or exchange".
3. LamportPay creates the Stables transfer and shows: deposit address, QR code (Solana Pay
   `solana:<address>?amount=<amount>&spl-token=<mint>` URI), exact amount, token (USDC), network
   (Solana), and a countdown to the deposit deadline.
4. The page watches for the deposit and shows: detected → transaction hash (explorer link) →
   Stables status, using the existing status sync.

## Is it compatible with the current model?

| Question                                                                  | Answer                                                                                                                                                  | Basis                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Can a deposit be matched to the right payment without a wallet signature? | Yes. Each Stables transfer has its own unique deposit address (answer #4), so a deposit to that address belongs to that transfer.                       | Stables answer #4                                                                   |
| Is it still non-custodial?                                                | Yes. The address is Stables'; LamportPay never receives funds.                                                                                          | Architecture                                                                        |
| Is the payer tied to the verified customer?                               | Only by the transfer: the KYC'd customer created it. The paying wallet is not proven to be theirs (no signature).                                       | —                                                                                   |
| Travel Rule                                                               | Stables said it asks for no wallet verification (answer #7); still, a payment from an exchange is a third-party custodian sending on the user's behalf. | NEEDS STABLES: are exchange-originated deposits accepted for a customer's transfer? |
| Wrong amounts                                                             | Much more likely than with the in-app button (users type the amount). Underpayment fails and needs a manual return (answer #1).                         | Stables answer #1                                                                   |
| Partial / split deposits                                                  | Not summed by LamportPay; Stables' behaviour unknown.                                                                                                   | NEEDS STABLES                                                                       |
| Deposit after the deadline                                                | Unknown.                                                                                                                                                | NEEDS STABLES (wrong-amount-deposits.md, question 5)                                |

## Required before building

1. **Stables confirmation:** exchange-originated deposits, split deposits, late deposits, and the
   deposit deadline per transfer.
2. **Business decision:** whether to accept deposits whose sender is not the customer's verified
   wallet (compliance exposure).
3. **Engineering (safe to do once 1–2 are settled):**
   - detect the deposit by watching the transfer's deposit address for the expected mint (server
     side, never trusting the browser) and record the signature with the existing uniqueness rule
     (`funding_signature` unique);
   - reuse the existing wrong-amount handling: reject, alert "wrong deposit amount", open a case;
   - QR generated client-side from server-provided values only; amount shown with all 6 decimals
     and a copy button; network and token named explicitly;
   - countdown from the server's deadline; after it, the page stops showing the address.

## Risks

- Highest wrong-amount rate of any flow → more manual returns through Stables.
- Exchange withdrawals can take minutes to hours and may arrive after the deadline.
- Some exchanges send USDC on other networks if the user picks the wrong one; funds sent on another
  network to a Solana address are not recoverable by LamportPay.

Recommendation: keep wallet-connected payments as the only flow for LIVE launch; revisit after the
Stables answers above and the first real-money results.
