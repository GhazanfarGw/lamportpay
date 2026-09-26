/**
 * LamportPay token configuration.
 *
 * Swaps (Jupiter): SOL in -> USDC out only. Other swap inputs (JUP, RAY, PYTH,
 * BONK) are intentionally NOT enabled yet.
 * Payments (Stables): funded in USDC or USDT on Solana, both settled by Stables.
 */

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/** Stablecoins a payment can be funded with, by Stables' lowercase code. */
export const PAYMENT_CURRENCIES = ["usdc", "usdt"] as const;
export type PaymentCurrency = (typeof PAYMENT_CURRENCIES)[number];

/** SPL mint on Solana mainnet for each payment stablecoin (both 6 decimals). */
export const PAYMENT_CURRENCY_MINTS: Record<PaymentCurrency, string> = {
  usdc: USDC_MINT,
  usdt: USDT_MINT,
};

export function isPaymentCurrency(value: unknown): value is PaymentCurrency {
  return (PAYMENT_CURRENCIES as readonly unknown[]).includes(value);
}

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
  [USDT_MINT]: { symbol: "USDT", name: "Tether USD", mint: USDT_MINT, decimals: 6 },
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
