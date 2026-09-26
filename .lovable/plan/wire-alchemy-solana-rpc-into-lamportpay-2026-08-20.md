# Wire Alchemy Solana RPC into LamportPay

## Goal
Replace the default public Solana RPC endpoints with Alchemy-hosted endpoints for testing, and verify both health checks and transaction verification work through Alchemy.

## Scope
- Existing Solana RPC layer: `src/lib/solana-rpc.server.ts`, `src/lib/solana-rpc.ts`
- Existing routes: `/api/solana/health`, `/api/solana/verify-tx`
- Existing UI: `SolanaRpcVerifier.tsx` on `/swap`
- No changes to Jupiter swap logic, Bridge, fiat payout, or KYC.

## Requirements from user
- Use Alchemy devnet RPC URL.
- Use Alchemy for other networks if URLs are provided.
- Test both RPC health and transaction verification.
- Alchemy should always override the public default endpoints when configured.

## Plan

1. Collect Alchemy RPC URLs
   - Ask user to paste the actual Alchemy devnet URL (and mainnet/testnet URLs if available).
   - Store them as runtime secrets:
     - `SOLANA_RPC_URL` (mainnet)
     - `SOLANA_DEVNET_RPC_URL` (devnet)
     - `SOLANA_TESTNET_RPC_URL` (testnet)
   - Note: if the URL contains an Alchemy API key, treat it as a secret.

2. Update RPC resolution
   - In `src/lib/solana-rpc.server.ts`, ensure the custom URL logic always wins when an env value is set for the requested cluster.
   - The current implementation already supports this; confirm it and keep the behavior.

3. Verify devnet RPC health via Alchemy
   - Call `/api/solana/health?cluster=devnet`.
   - Confirm response shows `reachable: true`, slot, blockHeight, and latency from the Alchemy endpoint.

4. Verify devnet transaction verification via Alchemy
   - Use a known devnet transaction signature (provided by user or found on devnet explorer).
   - Call `/api/solana/verify-tx` with the signature and `cluster: devnet`.
   - Confirm the response includes `found`, `success`, `confirmationStatus`, `feeLamports`, and `solLamportsDelta`.

5. UI/UX update
   - In `SolanaRpcVerifier.tsx`, show a small label when the active endpoint is a custom RPC provider (e.g., "Alchemy") so the user knows the request is going through their configured endpoint.

6. Update `.env.example`
   - Add `SOLANA_RPC_URL=`, `SOLANA_DEVNET_RPC_URL=`, `SOLANA_TESTNET_RPC_URL=` with a comment that they are optional Alchemy or custom RPC endpoints.

7. Run tests
   - Execute `tests/solana-rpc.test.ts` to ensure existing RPC validation and guards still pass.
   - Add a test that asserts the custom endpoint is used when configured.

8. Important limitation note
   - Jupiter swaps still only work on mainnet because Jupiter has no routing/liquidity on devnet/testnet.
   - The Alchemy devnet RPC can verify devnet transactions and RPC health, but it cannot be used to execute a real SOL → USDC swap.

## Deliverables
- Alchemy RPC endpoints stored as runtime secrets.
- `/api/solana/health` and `/api/solana/verify-tx` routing through Alchemy.
- UI indicator showing Alchemy as the active RPC provider.
- Updated `.env.example`.
- Passing test suite.
- Summary of what works on devnet vs. mainnet.
