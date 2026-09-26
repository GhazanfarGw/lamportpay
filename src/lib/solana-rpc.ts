/**
 * Solana RPC configuration and helpers.
 *
 * Clusters:
 *  - mainnet-beta: the only cluster where Jupiter routing/liquidity exists.
 *  - devnet / testnet: used to verify RPC connectivity and transaction
 *    verification logic with valueless test SOL. Jupiter swaps do NOT exist
 *    there, so swap execution can only be verified on mainnet with the
 *    0.001–0.01 SOL guard limits.
 */

export const SOLANA_CLUSTERS = ["mainnet-beta", "devnet", "testnet"] as const;
export type SolanaCluster = (typeof SOLANA_CLUSTERS)[number];

export const DEFAULT_RPC_URLS: Record<SolanaCluster, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
};

export const EXPLORER_CLUSTER_QUERY: Record<SolanaCluster, string> = {
  "mainnet-beta": "",
  devnet: "?cluster=devnet",
  testnet: "?cluster=testnet",
};

export function isSolanaCluster(value: unknown): value is SolanaCluster {
  return typeof value === "string" && (SOLANA_CLUSTERS as readonly string[]).includes(value);
}

/** Swap routing (Jupiter) is only available on mainnet. */
export function supportsJupiterSwap(cluster: SolanaCluster): boolean {
  return cluster === "mainnet-beta";
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Loose signature check: base58, 64-byte signatures are 86-88 chars. */
export function isLikelySignature(value: string): boolean {
  return BASE58.test(value) && value.length >= 64 && value.length <= 96;
}

export function explorerTxUrl(signature: string, cluster: SolanaCluster): string {
  return `https://explorer.solana.com/tx/${signature}${EXPLORER_CLUSTER_QUERY[cluster]}`;
}