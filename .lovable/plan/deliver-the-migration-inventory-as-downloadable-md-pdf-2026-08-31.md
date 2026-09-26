# Deliver the migration inventory as downloadable MD + PDF

I have all the information gathered (file tree, dependencies, full database schema and
policies, API routes, secrets map, routing/auth flow, integrations). Plan mode blocks writing
files, so approve this and I'll produce the documents.

## What I'll deliver

Two downloadable files, identical content:

- `LamportPay-Migration-Inventory.md`
- `LamportPay-Migration-Inventory.pdf`

Both attached in chat for download. Nothing in the app changes — no source files, no database,
no configuration.

## Document contents

1. Project structure — complete file tree plus full `package.json` dependency/dev-dependency
   list with versions and build scripts.
2. Database — backend URL and publishable key, the five tables (`user_roles`,
   `mock_kyc_submissions`, `mock_payout_transfers`, `admin_audit_log`, `admin_invites`) with
   every column, type, default, check constraint, foreign key, index, grant and RLS policy;
   the `app_role` enum, `has_role()` and `touch_updated_at()` functions, triggers, seed rows,
   and the three migration files. Notes that there are no storage buckets or edge functions.
3. Backend logic — the ten admin server functions, the auth middleware chain, and every HTTP
   route under `/api/**` (Jupiter order/execute/quote, Solana health/verify-tx, payout
   customer/external-account/quote/transfer, public payout webhook, MCP endpoints) with the
   guard behaviour of each. Plus the 43-test vitest suite.
4. Environment variables — every name, split into server-only and browser-exposed, each mapped
   to the file that reads it. Names only, no values.
5. Routing and auth — file-based TanStack Router layout (not React Router), public vs
   `_authenticated` routes, the sign-in / forgot-password / reset flow, session handling, and
   how the bearer token reaches server functions.
6. Third-party integrations — Jupiter, Alchemy Solana RPC, Phantom/Solflare, Solscan,
   Supabase, the payout partner client and webhook, and the MCP server.
7. Migration checklist — ordered, tickable steps for standing the project up elsewhere,
   including which Lovable-specific modules can be deleted.

## Technical notes

The PDF is rendered from the same markdown source with a monospace-friendly layout so the file
trees and SQL/route blocks stay aligned, then visually checked page by page before delivery.
