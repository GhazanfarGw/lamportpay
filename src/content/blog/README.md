# Publishing a new article

1. Copy an existing file in `posts/` to `posts/<your-slug>.ts`.
2. Fill in the exported `post` object:
   - `slug` — must match the filename and becomes the URL `/blog/<slug>`.
   - `metaTitle` — search-result title (aim for under ~60 characters). The
     route appends `| LamportPay`.
   - `description` — meta description, 140–160 characters.
   - `summary` — one-sentence answer rendered directly under the H1.
   - `body` — blocks: `p`, `h2`, `h3`, `ul`, `ol`, `callout`, `quote`.
   - `productLinks` — 2–3 links into the product (internal linking).
   - `relatedSlugs` — 2–3 other article slugs.
3. Import it in `index.ts` and add it to `RAW_POSTS`.

That is all. The listing page, article route, breadcrumbs, Article and
BreadcrumbList structured data, related-reading blocks and `/sitemap.xml`
all read from that array automatically.

## Content rules (from the LamportPay Brand Book)

- Never claim live fiat payout, real KYC, custody, licences, partnerships,
  supported countries or transaction volumes.
- Label capability status: LIVE (wallet connect, SOL→USDC swap under strict
  limits), DEMO/SIMULATED (quotes, FX, KYC, payout, receipts), DISABLED
  (fiat payout, real KYC/AML), PLANNED (regulated partners, corridors).
- "LamportPay" is the brand; "Lamport Pay Ltd" is the legal entity.
- Jupiter is swap infrastructure, not a commercial partner.
- Use "regulated payout infrastructure partner" / "regulated settlement
  partner"; never name an unconfirmed provider. "Blockchain bridge" refers
  only to the technical mechanism.
- Write useful, substantive articles. No thin keyword pages.
