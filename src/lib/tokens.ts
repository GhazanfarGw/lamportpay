/**
 * LamportPay token configuration.
 *
 * Scope for now: SOL in -> USDC out only.
 * Additional input mints (USDT, JUP, RAY, PYTH, BONK) are intentionally
 * NOT enabled yet.
 */

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Output mint is always forced to USDC. */
export const OUTPUT_MINT = USDC_MINT;

/** The only input mints currently accepted. */
export const SUPPORTED_INPUT_MINTS = [SOL_MINT] as const;

export type SupportedInputMint = (typeof SUPPORTED_INPUT_MINTS)[number];

export interface TokenInfo {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
}

export const TOKENS: Record<string, TokenInfo> = {
  [SOL_MINT]: { symbol: "SOL", name: "Solana", mint: SOL_MINT, decimals: 9 },
  [USDC_MINT]: { symbol: "USDC", name: "USD Coin", mint: USDC_MINT, decimals: 6 },
};

export function isSupportedInputMint(mint: string): mint is SupportedInputMint {
  return (SUPPORTED_INPUT_MINTS as readonly string[]).includes(mint);
}

/** Always returns the forced output mint (USDC). */
export function getOutputMint(): string {
  return OUTPUT_MINT;
}

export function getTokenInfo(mint: string): TokenInfo | undefined {
  return TOKENS[mint];
}
