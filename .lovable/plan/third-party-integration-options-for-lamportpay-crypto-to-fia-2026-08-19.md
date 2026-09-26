# Third-Party Integration Options for LamportPay Crypto-to-Fiat Workflow

This plan surveys the current LamportPay workflow and recommends third-party APIs that can power the full crypto-to-fiat route while staying consistent with the existing demo architecture: **Solana-first, USDC-settled, non-custodial, partner-led compliance.**

## Current workflow recap

From the whitepaper, docs, and `/send` demo, the intended flow is:

1. **Sender enters transfer details** (token, amount, destination corridor, payout method, recipient).
2. **LamportPay creates a payment record** and quotes the route.
3. **Crypto is swapped to USDC** on Solana if the input token is not already USDC.
4. **USDC settlement is verified** on-chain.
5. **A licensed settlement partner** converts USDC to local fiat and pays the recipient.
6. **LamportPay shows a receipt** and tracks status.

The current demo implements only step 3 (a real Jupiter SOL→USDC swap back to the user's own wallet) and mocks the rest. Steps 4–6 are disabled until a partner agreement is in place.

## Layer 1: Crypto-to-crypto swap (SOL → USDC)

This layer already exists in `/swap` and `/api/jupiter/*`. It is the **on-chain exchange** that turns volatile or non-USD crypto into a stable settlement token.

| Provider                  | API                    | Fit for LamportPay        | Notes                                                                      |
| ------------------------- | ---------------------- | ------------------------- | -------------------------------------------------------------------------- |
| **Jupiter**               | `api.jup.ag/swap/v2/*` | **Current / recommended** | Deepest Solana liquidity, 100+ sources, token routing. Already integrated. |
| **Raydium**               | Direct SDK + on-chain  | Secondary option          | Good for specific pool routes, but Jupiter already aggregates Raydium.     |
| **Orca**                  | SDK + on-chain         | Secondary option          | Concentrated liquidity on Solana; usually reached through Jupiter.         |
| **1inch / 0x / ParaSwap** | REST API               | Cross-chain alternative   | Useful if the platform later expands beyond Solana.                        |

**Recommendation:** Keep Jupiter as the primary swap aggregator on Solana. It is the de facto standard, reduces integration work, and already supports the strict SOL→USDC guard that the current code enforces.

## Layer 2: Stablecoin settlement verification

Before the payout partner is asked to move fiat, the app must confirm that USDC actually arrived at the destination it controls. This is an on-chain verification layer, not a third-party API.

- Use **Solana RPC** (`helius`, `quicknode`, `solana-api` / public RPC) to:
  - Confirm the transaction containing the Jupiter swap.
  - Verify the final USDC token account balance.
  - Match the transaction signature against the payment record.

Provider options: **Helius**, **QuickNode**, **Triton**, or Solana Foundation public RPC. For a production service, a paid RPC/websocket plan is required.

## Layer 3: Fiat off-ramp / payout (USDC → local currency)

This is the layer the demo currently mocks. It converts verified USDC into local fiat and pays out to bank accounts, mobile wallets, cards, or cash pickup. The partner must be a licensed money services business, EMI, or payment institution in the destination corridor.

### Recommended primary options

| Provider         | Coverage                                                          | API model                          | Why it fits                                                                                                              |
| ---------------- | ----------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Bridge**       | USD, EUR, BRL, MXN, others; liquidation addresses for many chains | REST API + webhooks                | Already named in the whitepaper and `/send` demo. Supports Solana USDC, liquidation addresses, and customer/KYC objects. |
| **Crossmint**    | 40+ countries, 13+ rails (ACH, SEPA, Pix, etc.)                   | REST API + hosted/embedded widgets | Broad stablecoin off-ramp API, Solana support, treasury and embedded modes.                                              |
| **Transak**      | 18+ countries, bank/card/mobile wallet payouts                    | REST API + SDK widget              | Strong off-ramp coverage, white-label API, KYC handled by Transak.                                                       |
| **Yellow Card**  | 50+ fiat currencies, strong in Africa (NGN, etc.)                 | REST API                           | Good fit for Nigeria, Ghana, Kenya, other African corridors. Mobile-money and bank payout support.                       |
| **Bitso**        | Latin America (MXN, BRL, ARS, COP)                                | REST API + SDK                     | Strong in Mexico, Brazil, Colombia, Argentina. Fits the LATAM corridors in the demo.                                     |
| **Ramp Network** | On/Off-ramp in Europe + emerging markets                          | REST API + widget                  | Good for EUR corridors and card/bank payouts.                                                                            |
| **Nium**         | 100+ countries, bank payouts, cards                               | REST API                           | Global payout infrastructure, fits B2B/embedded models.                                                                  |
| **Thunes**       | 130+ countries, mobile wallets, bank, cash                        | REST API                           | Strong for mobile wallets and emerging-market corridors.                                                                 |

### Corridor mapping for the current demo

Current demo corridors: **PKR, INR, NGN, PHP, MXN, BDT, EGP, COP, BRL, PEN.**

| Corridor              | Best-fit partners (off-ramp)                               | Notes                                                       |
| --------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| **PKR (Pakistan)**    | Transak, Thunes, local PSPs                                | Pakistan is limited; many global providers do not serve it. |
| **INR (India)**       | Transak, Bridge, Crossmint, local banking APIs             | UPI/IMPS bank payouts are common.                           |
| **NGN (Nigeria)**     | **Yellow Card**, Transak, Bridge, Crossmint, local fintech | Mobile money + bank transfers are dominant.                 |
| **PHP (Philippines)** | Transak, Crossmint, Thunes, local e-wallets                | GCash/PayMaya style mobile wallet payout.                   |
| **MXN (Mexico)**      | **Bitso**, Bridge, Transak, Crossmint                      | SPEI bank transfer is standard.                             |
| **BDT (Bangladesh)**  | Thunes, local PSPs                                         | Limited direct API coverage; may need local aggregator.     |
| **EGP (Egypt)**       | Thunes, local PSPs                                         | Limited direct global provider coverage.                    |
| **COP (Colombia)**    | **Bitso**, Transak, Crossmint, Bridge                      | PSE/bank transfers.                                         |
| **BRL (Brazil)**      | **Bitso**, Bridge, Crossmint, Transak                      | Pix is the preferred rail.                                  |
| **PEN (Peru)**        | Transak, Crossmint, local PSPs                             | Interbank transfers.                                        |

**Recommendation:** Start with **Bridge** as the first partner (already in the whitepaper) because it supports the USDC-first model and can be expanded to multiple corridors. Then add corridor-specific specialists:

- **Yellow Card** for African corridors (NGN, future GHS/KES).
- **Bitso** for LATAM (MXN, BRL, COP, ARS).
- **Crossmint or Transak** for general global coverage (INR, PHP, EUR, etc.).

## Layer 4: Identity / compliance (KYC/KYB)

The current demo shows KYC as a partner responsibility. In production, the payout partner typically handles KYC. Some providers also expose KYC APIs or hosted flows.

- **Bridge** — customer and external-account APIs include KYC/KYB orchestration.
- **Crossmint** — handles KYC/KYB as part of off-ramp flows.
- **Transak** — KYC handled inside its widget/flow.
- **Yellow Card** — compliance built-in, API-driven customer verification.
- **Bitso** — identity verification as part of its platform.
- **Dedicated KYC APIs** (optional): **Sumsub**, **Onfido**, **Persona**, **Jumio**. These can be used if LamportPay wants to pre-verify users before routing to a payout partner, but they add compliance burden and should be used only after legal review.

**Recommendation:** Let the payout partner own KYC/KYB in the first phase (matches the current “partner-led compliance” positioning). Add a dedicated KYC provider only if the business model requires it and counsel approves.

## Suggested end-to-end integration flow

For a production-ready crypto-to-fiat route, the flow would look like this:

```text
User inputs amount/corridor/recipient
        ↓
LamportPay backend creates payment record
        ↓
If token is not USDC:
  Call Jupiter /api/jupiter/order
  User signs transaction in wallet
  Call Jupiter /api/jupiter/execute
  Verify USDC landed at partner-controlled address (Solana RPC)
Else (token is USDC):
  User sends USDC directly to partner liquidation address
        ↓
Settlement partner (Bridge / Yellow Card / Bitso / etc.) receives USDC
        ↓
Partner performs KYC if needed
        ↓
Partner converts USDC to local fiat and sends payout
        ↓
Partner webhooks update payment status
        ↓
LamportPay shows receipt and tracking
```

## Phased implementation plan

### Phase 1 — Keep current demo (now)

- Keep Jupiter SOL→USDC swap demo.
- Keep all fiat/KYC/Bridge flows as mock placeholders.
- Update whitepaper/docs to reflect the exact current demo scope.

### Phase 2 — Add real swap verification

- Add a server route `/api/solana/verify-transaction` that confirms a Solana transaction and final USDC token-account balance using a paid RPC provider.
- Link the verified signature to the payment record.

### Phase 3 — Integrate one payout partner (Bridge recommended)

- Create a **sandbox** Payout partner API key.
- Add server routes: `/api/bridge/quote`, `/api/bridge/customer`, `/api/bridge/external-account`, `/api/bridge/transfer`, `/api/bridge/webhook`.
- Replace the mock quote in `/send` with real payout partner sandbox data for supported corridors.
- Enable only corridors that payout partner sandbox supports.
- Keep KYC as a partner-hosted step.

### Phase 4 — Add corridor-specific specialists

- Add **Yellow Card** for African corridors, **Bitso** for LATAM, etc.
- Build a routing table that selects the cheapest/fastest available partner per corridor.
- Add partner-agnostic webhook handlers and status mapping.

### Phase 5 — Legal and compliance gating

- KYB with each partner.
- Legal review of user-facing copy and terms.
- Add real terms, privacy policy, and risk disclosures.
- Enable live payout only after partner approval and legal sign-off.

## Security and compliance guardrails

- **Never store private keys or seed phrases.** Current code already rejects these fields in `/api/jupiter/order` and `/api/jupiter/execute`.
- **Keep API keys server-side.** Never expose partner API keys or the Jupiter API key in the browser.
- **Non-custodial model.** LamportPay should not take custody of user funds. USDC should flow to a partner-controlled address or the user's own wallet, not to a LamportPay wallet.
- **Partner-led KYC.** Do not perform KYC unless the business model legally requires it.
- **Clear demo disclaimers.** Keep the existing disclaimers on `/`, `/send`, `/swap`, and in the footer until live payout is approved.
- **Rate limits and fraud monitoring.** Add per-user rate limits and webhook signature verification before any production launch.

## Recommended next step

If you want to proceed, I will create a focused implementation plan for **Phase 2 + Phase 3** (payout partner sandbox integration with real quote, customer creation, and transfer endpoints) behind a feature flag so the demo stays safe while the real integration is built.
