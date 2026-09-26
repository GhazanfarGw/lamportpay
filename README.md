# LamportPay Bridge

Build a full professional fintech website and demo app for:

LamportPay

Tagline:

Crypto in. Local money out.

Main headline:

Send crypto. Recipient receives local currency.

Product description:

LamportPay is a Solana-first crypto-to-local-currency payment routing demo. It helps users pay with supported crypto assets, settle through USDC, and simulate local-currency payout through Bridge as the first settlement partner.

Important rules:

- This is a demo only.

- Do not process real crypto.

- Do not process real fiat.

- Do not use real KYC.

- Do not use real Bridge API.

- Do not use real Jupiter API.

- Do not use real API keys.

- Do not collect real bank account details.

- Do not collect ID documents.

- Use mock/demo data only.

- Keep the code ready so real Bridge, Jupiter, Solana, Phantom wallet, Supabase, and API integrations can be added later.

Design inspiration:

Use these websites only as inspiration. Do not copy logos, exact text, exact colors, images, or proprietary layouts.

1. Wise: https://wise.com/us/send-money/

Use for simple transfer calculator style, clear fee display, and beginner-friendly transfer UX.

2. Stripe Crypto Onramp: https://stripe.com/crypto-onramp

Use for premium fintech design, clean spacing, strong trust language, and professional CTA sections.

3. Bridge: https://www.bridge.xyz/

Use for stablecoin infrastructure and partner/API positioning.

4. Crossmint Offramps: https://www.crossmint.com/products/offramps

Use for stablecoin-to-fiat payout explanation and compliance-partner wording.

5. Ramp Network: https://ramp.network/

Use for friendly crypto buy/sell UX.

6. Transak: https://transak.com/

Use for hosted crypto on/off-ramp checkout simplicity.

Overall style:

Wise simplicity + Stripe polish + Bridge/Crossmint infrastructure credibility.

Build these pages:

1. Home page: /

2. Send demo page: /send

3. How it works page: /how-it-works

4. White paper page: /whitepaper

5. Compliance page: /compliance

6. Developer docs page: /docs

7. Contact / waitlist page: /contact

Home page structure:

Hero section:

- LamportPay

- Crypto in. Local money out.

- Send crypto. Recipient receives local currency.

- Short paragraph:

  “LamportPay helps users pay with supported crypto assets, settle through USDC, and route local-currency payout requests through licensed settlement partners.”

Buttons:

- Start Demo Transfer

- Read White Paper

- Join Waitlist

Trust strip:

Demo only • No real crypto processed • Partner-led KYC • USDC settlement • Bridge-first flow

Add a large transfer simulator card on the homepage:

Fields:

- You send: amount

- Token: USDC, SOL, USDT, JUP, RAY, PYTH, BONK

- Recipient country: Pakistan, India, Nigeria, Philippines, Mexico, Bangladesh, Egypt, Colombia, Brazil, Peru

- Recipient currency: PKR, INR, NGN, PHP, MXN, BDT, EGP, COP, BRL, PEN

- Payout method: Bank account, Mobile wallet, Card, Cash pickup

Show mock output:

- Estimated USDC settlement

- FX rate

- Bridge fee

- LamportPay fee

- Recipient receives

- Estimated delivery time

- Demo only badge

Add section: Why LamportPay

Cards:

- Fast crypto checkout

- USDC settlement

- Bridge-first partner flow

- AI transfer assistant

- Local-currency payout simulation

- Compliance-aware design

Add section: How it works

Show simple flow:

Choose crypto

→ Get Bridge quote

→ Complete partner KYC

→ Settle through USDC

→ Bridge processes payout

→ Track receipt

Add section: AI Transfer Assistant

Create a friendly AI-style card where the user can type:

“I want to send 100 USDC to Pakistan.”

Then show mock AI output:

- Token: USDC

- Amount: 100

- Receiver country: Pakistan

- Receiver currency: PKR

- Suggested payout method: Bank account

- Partner: Bridge

- Note: “This is a demo suggestion only.”

Add section: AI Fee Explainer

Explain in simple words:

- Bridge fee

- LamportPay platform fee

- FX rate

- Recipient amount

- Quote expiry

Add section: Safety Assistant

Show warnings:

- Never share your seed phrase.

- Crypto payments may be irreversible.

- KYC is handled by the licensed partner.

- Demo values are not live rates.

Send demo page: /send

Build the full Bridge-only demo flow:

Step 1: Enter transfer details

Fields:

- Token

- Amount

- Sender currency display: USD, GBP, EUR, CAD, AUD, AED

- Receiver country

- Receiver currency

- Recipient name

- Payout method

- Mock recipient details

Button:

Get Bridge Quote

Step 2: Bridge Quote

Show:

- Provider: Bridge

- Provider type: Stablecoin orchestration / settlement partner

- Input token

- Input amount

- Estimated USDC settlement amount

- FX rate

- Bridge fee

- LamportPay platform fee

- Total fee

- Recipient receives

- Estimated delivery time

- KYC method: Bridge-hosted KYC

- Payout method

- Corridor support: Demo supported

- Status note: Mock quote for demo only

Button:

Continue to Bridge KYC

Step 3: Bridge KYC

Show:

“Identity verification is handled by Bridge or the selected licensed payout partner, not by LamportPay.”

Show:

Selected Partner: Bridge

KYC Status: Not Started

Button:

Complete Mock Bridge KYC

After click:

KYC Status: Approved

Button:

Confirm Demo Payment

Step 4: Payment Confirmation

Show:

- Input token

- Input amount

- Estimated USDC settlement amount

- Receiver country

- Receiver currency

- Recipient name

- Selected partner: Bridge

- Bridge fee

- LamportPay fee

- Recipient receives

- Estimated delivery time

- Payout method

Button:

Simulate Payment

After clicking:

Generate mock Solana transaction hash and mock Bridge reference ID.

Step 5: Tracking

Show timeline:

1. Payment created

2. Bridge selected as settlement partner

3. Mock Bridge KYC approved

4. Crypto converted to USDC

5. USDC settlement confirmed

6. Payout request sent to Bridge

7. Bridge processing payout

8. Recipient paid

Step 6: Receipt

Show:

- Payment ID

- Input token

- Input amount

- USDC settlement amount

- Receiver country

- Receiver currency

- Recipient name

- Recipient receives

- Selected partner: Bridge

- Bridge reference ID

- Bridge fee

- LamportPay platform fee

- FX rate used

- Payout method

- Mock Solana transaction hash

- Status: Paid

Buttons:

- Start New Payment

- Copy Receipt Details

How it works page: /how-it-works

Explain this flow visually:

User enters transfer details

→ LamportPay creates payment record

→ Bridge quote generated

→ Partner KYC

→ Jupiter swap to USDC planned

→ USDC settlement verified

→ Bridge payout processing

→ Receipt shown

Add a developer-friendly diagram too:

Frontend form

→ POST /api/payments

→ POST /api/bridge-quote

→ POST /api/bridge-kyc/start

→ POST /api/bridge-kyc/complete

→ POST /api/payments/confirm

→ POST /api/jupiter/quote

→ POST /api/solana/verify-transaction

→ POST /api/bridge-transfer

→ GET /api/payments/[paymentId]

→ GET /api/receipt/[paymentId]

White paper page: /whitepaper

Add detailed white paper with these sections:

1. Executive Summary

LamportPay is a Solana-first crypto-to-local-currency payment routing platform. It helps users pay with supported crypto assets, settle through USDC, and route local-currency payout requests through licensed settlement partners such as Bridge.

2. Problem

Crypto is global and fast, but recipients usually want local currency in a bank account, mobile wallet, card, or cash pickup channel. Existing flows are complex for normal users.

3. Solution

LamportPay provides a simple transfer interface, AI assistant, USDC settlement model, Bridge-first payout simulation, and status tracking.

4. Product Positioning

LamportPay is a technology routing platform, not a bank, money transmitter, custodian, exchange, or remittance company.

5. Core Flow

Sender enters transfer details

→ LamportPay creates payment

→ Bridge quote generated

→ Partner KYC

→ User confirms crypto payment

→ Jupiter swaps supported token into USDC later

→ USDC settlement verified

→ Bridge processes payout

→ Recipient receives local currency

→ LamportPay shows receipt

6. Technology Architecture

Frontend:

Next.js, Tailwind CSS, transfer simulator, AI assistant, receipt dashboard.

Backend:

API routes, payment state machine, Bridge adapter, Jupiter adapter, Solana verifier, webhook handler, database layer.

Blockchain:

Solana wallet connection, USDC settlement, Jupiter token-to-USDC swap, Solana transaction verification.

Partner:

Bridge customer/KYC flow, Bridge transfer flow, Bridge webhook/status updates.

Database:

Users, payments, quotes, KYC status, Bridge references, Solana transaction signatures, timeline events, receipts.

7. AI Layer

AI transfer assistant, fee explanation, scam warning, payout method guidance, support assistant. AI does not approve KYC, perform AML, or make regulated decisions.

8. Liquidity Layer

Use Jupiter first for Solana token-to-USDC swaps. If user pays in USDC, skip swap.

9. Settlement Partner Layer

Use Bridge first. Add other partners later, such as Crossmint, Nium, Thunes, Transak, Ramp, Bitso, and Yellow Card.

10. Supported Demo Assets

USDC, SOL, USDT, JUP, RAY, PYTH, BONK.

11. Supported Demo Corridors

Pakistan PKR, India INR, Nigeria NGN, Philippines PHP, Mexico MXN, Bangladesh BDT, Egypt EGP, Colombia COP, Brazil BRL, Peru PEN.

12. Payment Status Lifecycle

CREATED

QUOTE_GENERATED

KYC_PENDING

KYC_APPROVED

PAYMENT_CONFIRMED

JUPITER_SWAP_STARTED

USDC_SETTLED

PAYOUT_SENT_TO_BRIDGE

BRIDGE_PROCESSING

PAID

FAILED

REFUNDED

13. Compliance Positioning

LamportPay does not custody user funds, control private keys, issue balances, perform KYC, or independently transmit money. Licensed partners handle KYC, KYB, AML, sanctions screening, Travel Rule, FX/off-ramp, payout processing, and settlement.

14. Business Model

Small platform fee per completed transfer, SaaS/API fee for businesses, premium dashboard, partner referral/commission where legally allowed.

15. Roadmap

Phase 1: Demo website

Phase 2: Backend MVP

Phase 3: Phantom wallet + Solana devnet

Phase 4: Jupiter quote/swap integration

Phase 5: Bridge sandbox integration

Phase 6: Controlled live pilot after legal and partner approval

16. Risk Management

Risks: regulation, KYC failure, payout delay, slippage, wrong wallet, fraud, provider approval.

Mitigations: partner-led KYC before payment, USDC settlement, quote expiry, no custody, no user balances, clear refund/failure policy.

17. Conclusion

LamportPay aims to make crypto-to-local-currency transfer simple, explainable, and partner-compliant.

Compliance page: /compliance

Explain:

- LamportPay is a technology platform.

- LamportPay does not custody funds.

- LamportPay does not perform real KYC.

- LamportPay does not independently transmit money.

- Licensed partners handle regulated payout activity.

- Bridge is the first planned/demo settlement partner.

- Real launch requires partner approval, KYB, legal review, and corridor approval.

Developer docs page: /docs

Show:

Frontend:

Next.js + Tailwind CSS

Backend:

API routes and payment state machine

Liquidity:

Jupiter planned

Settlement:

Bridge planned

Blockchain:

Solana + USDC

Database:

Supabase/PostgreSQL planned

API flow:

POST /api/payments

POST /api/bridge-quote

POST /api/bridge-kyc/start

POST /api/bridge-kyc/complete

POST /api/payments/confirm

POST /api/jupiter/quote

POST /api/solana/verify-transaction

POST /api/bridge-transfer

GET /api/payments/[paymentId]

GET /api/receipt/[paymentId]

Contact page: /contact

Create waitlist/partner form fields:

- Name

- Email

- Company

- Role: User, Developer, Investor, Payout Partner, Other

- Interest: Demo access, Partnership, API access, Investment, Other

- Message

Button:

Request Access

Use mock submission only. Show success message:

“Thanks. Your LamportPay request has been saved for demo purposes.”

Backend/demo logic:

Create mock data and functions for:

- Payment creation

- Bridge quote generation

- Mock KYC approval

- Mock payment confirmation

- Mock Solana transaction hash

- Mock Bridge reference ID

- Tracking timeline

- Receipt generation

Demo FX rates:

USD to PKR: 278

USD to INR: 83

USD to NGN: 1500

USD to PHP: 58

USD to MXN: 18

USD to BDT: 117

USD to EGP: 48

USD to COP: 4000

USD to BRL: 5.5

USD to PEN: 3.7

Fee logic:

Bridge fee: 1% of amount, minimum $1

LamportPay fee: 0.5% of amount

Total fee = Bridge fee + LamportPay fee

Design requirements:

- Light theme

- Very friendly

- Premium fintech look

- Big clean transfer card

- Rounded cards

- Smooth spacing

- Mobile responsive

- Minimal crypto jargon

- Clear CTAs

- Blue/purple accent

- Trust-focused

- Professional enough for investors and partners

- Simple enough for normal users

Footer disclaimer on every page:

“Demo only. LamportPay does not currently process real crypto, fiat, KYC, FX conversion, or bank payouts.”

Do not add:

- Real wallet connection

- Real Solana transaction

- Real Jupiter API

- Real Bridge API

- Real KYC

- Real payout

- Real database

- Any API keys

Build the app cleanly and make all pages connected through navigation.

## Development

Requires Node.js 22+ and npm.

```sh
npm install
cp .env.example .env   # then fill in the values
npm run dev            # http://localhost:8080
```

## Deployment (Vercel)

`npm run build` uses the Nitro `vercel` preset and writes `.vercel/output`, which Vercel
deploys automatically. Set the same environment variables from `.env` in the Vercel
project settings. For a plain Node server instead, build with `NITRO_PRESET=node-server`.
