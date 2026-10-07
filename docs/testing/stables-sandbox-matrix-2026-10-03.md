# Stables sandbox payment matrix — 3 Oct 2026

TEST MODE, Solana devnet, Stables sandbox. No real funds. Nothing was forced: every status is what
Stables' `GET /transfers/{id}` reports.

**Method.** Each payment went through LamportPay's `/pay` API as the verified test user
(create → quote → payout-details check → transfer; the same endpoints the `/pay` screen calls).
The deposit was simulated from **Admin → Payments → Simulate deposit**. Statuses were left to the
automatic live sync; `npm run reconcile` was not run. Results were read from four places: the
frontend (`/api/payments/:id` and the `/pay` page), the database, the admin payments list and
Stables itself (`node scripts/stables-transfer-status.mjs`).

**Baseline.** The same corridors were probed directly on the Stables API, bypassing LamportPay
(`scripts/stables-sandbox-lifecycle-probe.mjs`). The results were identical.

**Amount.** 102.040817 USDC went to Stables (100 for GBP).

| Currency | Amount | Stables result | LamportPay result | Admin result | Final state | Notes |
|---|---:|---|---|---|---|---|
| GBP | 100 | completed | COMPLETED | completed | COMPLETED | Only multiples of 20 USDC; other amounts → Stables 500 on transfer creation |
| INR | 102.04 | completed | COMPLETED | completed | COMPLETED | 10 USDC: quote refused |
| PHP | 102.04 | completed | COMPLETED | completed | COMPLETED | 10 USDC: quote refused |
| USD | 102.04 | completed (via awaiting_funds_collection → in_progress) | COMPLETED | completed | COMPLETED | 10 USDC: quote refused |
| ARS | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | never progresses |
| BRL | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | never progresses |
| COP | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | never progresses |
| GHS | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | earlier GHS in_progress 14+ h |
| KES | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | never progresses |
| MXN | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | never progresses |
| NGN | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | same at 9.8 / 105 / 500 |
| RWF | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | never progresses |
| TZS | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | never progresses |
| UGX | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | never progresses |
| XAF | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | never progresses |
| XOF | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | never progresses |
| ZAR | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | never progresses |
| ZMW | 102.04 | in_progress | IN_PROGRESS | in progress | IN_PROGRESS | never progresses |
| AUD | 102.04 | quote 422 "No route is currently available" | refused: "not supported" | — | NO ROUTE | completed on 27 Sep |
| CNY | — | not tested | not offered | — | EXCLUDED | owner decision |

**Match.** LamportPay matched Stables on 18/18 payments: frontend, database and admin list.
No LamportPay bug was found and no payment logic was changed.

**Comparison with earlier runs**
- UK 1162ff6f: wallet-approved, then COMPLETED by live sync 18 s later.
- GHS 4734c7e2: in_progress since 3 Oct 01:31 UTC.
- NGN fe62b23e: in_progress since 2 Oct 23:02 UTC.

All three are consistent with the matrix.

## Questions for Stables (only items that need Stables)
1. **Sandbox completion by corridor.** After `simulate-deposit`, ARS, BRL, COP, GHS, KES, MXN, NGN, RWF, TZS, UGX, XAF, XOF, ZAR and ZMW stay `in_progress` indefinitely; GBP, INR, PHP and USD complete. Is that expected? Is there a sandbox control to complete or fail them?
2. **Production behaviour of those corridors.** Do they complete in production, and what is the typical time per corridor?
3. **GBP amount restriction.** GBP `POST /transfer` returns 500 unless the amount is a multiple of 20 USDC. Correlation ids: fce3764e-42e7-4ad5-8db9-d66ccd9be722, 5ff52173-5c76-4f12-a535-b3b1490a1772, 034c3a29-fb48-444c-81d8-91e57085a100. Is this a sandbox bug or a real rule? If it is a rule, could the API return a 4xx with it?
4. **AUD route.** AUD now has no route (it worked on 27 Sep). Was it removed on purpose? Is it available in production?
5. **Minimum and maximum amounts.** INR, USD and PHP refuse quotes at 10 USDC. What are the minimum and maximum amounts per corridor, in sandbox and production? Is there an endpoint for them?
6. **Production webhooks.** The sandbox emits only `transfer.created`, never `transfer.updated.status_transitioned`. Does production send one for every status change?
7. **Final payout amount.** `actual_payout` is missing after `completed` in sandbox. Is it populated in production?

## Slack message for the Stables team (draft — not sent)

> Hi Stables team 👋 We ran a full sandbox payout matrix this week (19 currencies, simulated deposits via `sandbox/simulate-deposit`, statuses read from `GET /transfers/{id}`). Summary:
> • ✅ Completed: GBP, INR, PHP, USD
> • ⏳ Stay `in_progress` indefinitely (14h+ for some): ARS, BRL, COP, GHS, KES, MXN, NGN, RWF, TZS, UGX, XAF, XOF, ZAR, ZMW
> • ❌ AUD: quote 422 "No route is currently available" (worked on 27 Sep)
> • ⚠️ GBP `POST /transfer` returns 500 unless the amount is a multiple of 20 USDC (e.g. corr. id 5ff52173-5c76-4f12-a535-b3b1490a1772)
> • INR/USD/PHP refuse quotes at 10 USDC
> • The sandbox message log only shows `transfer.created`, no `transfer.updated.status_transitioned`
> Questions:
> 1. Is the `in_progress` behaviour for those 14 corridors expected in sandbox, and is there a way to force `completed`/`failed`?
> 2. Do those corridors complete normally in production, and with what typical timings?
> 3. Is the GBP multiple-of-20 behaviour a sandbox bug or a real rule? Could it return a 4xx instead of 500?
> 4. Was AUD removed on purpose? Is it available in production?
> 5. What are the per-corridor min/max amounts (sandbox and production)?
> 6. Does production send `status_transitioned` webhooks for every change?
> 7. Is `actual_payout` populated in production after `completed`?
> Happy to share transfer IDs for any of these. Thanks!

## Stables answers (recorded 7 Oct 2026, shared Questions sheet #49–55)

| # | Question | Stables answer | What changed in LamportPay |
|---|---|---|---|
| 49 | 14 corridors stay `in_progress` in sandbox | Some downstream providers have no fully functional sandbox; test these fully in production with small payments. | Nothing in code. The 14 corridors can only be proven by the controlled real-money test (owner approval required). |
| 50 | Production timing for those corridors | African and LATAM rails are local rails: same day unless an RFI occurs. | Nothing in code. The 2 h "stuck at Stables" admin alert stays. |
| 51 | GBP 500 unless a multiple of 20 USDC | Not answered yet. | — |
| 52 | AUD route | AUD is available in production. | Nothing in code: AUD is already in the corridor list; the sandbox refusal comes from Stables' "no route" answer. |
| 53 | Per-corridor amount limits | Not answered yet (#5: minimum 15 USD; maximums by agreement). | **Minimum set to 15 USDC in LIVE and TEST** (owner decision 7 Oct 2026). |
| 54 | Production status webhooks | Not answered yet (#1 says status changes use `transfer.updated.status_transitioned`; #3 still being checked). | Live status sync (polling) stays. |
| 55 | `actual_payout` in production | Not answered yet. | — |
