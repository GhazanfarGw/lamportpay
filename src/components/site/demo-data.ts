export const TOKENS = ["USDC", "SOL", "USDT", "JUP", "RAY", "PYTH", "BONK"] as const;
export type Token = (typeof TOKENS)[number];

export const TOKEN_USD: Record<Token, number> = {
  USDC: 1,
  USDT: 1,
  SOL: 165,
  JUP: 0.85,
  RAY: 2.4,
  PYTH: 0.42,
  BONK: 0.000025,
};

export const CORRIDORS = [
  { country: "Pakistan", currency: "PKR", rate: 278, flag: "🇵🇰" },
  { country: "Nigeria", currency: "NGN", rate: 1500, flag: "🇳🇬" },
  { country: "Philippines", currency: "PHP", rate: 58, flag: "🇵🇭" },
  { country: "Mexico", currency: "MXN", rate: 18, flag: "🇲🇽" },
  { country: "Colombia", currency: "COP", rate: 4000, flag: "🇨🇴" },
  { country: "Brazil", currency: "BRL", rate: 5.5, flag: "🇧🇷" },
] as const;

// Bank-to-bank payouts only (business decision).
export const PAYOUT_METHODS = ["Bank account"] as const;
export const SENDER_CURRENCIES = ["USD", "GBP", "EUR", "CAD", "AUD", "AED"] as const;

export function calcQuote(amount: number, token: Token, currency: string) {
  const usdValue = amount * (TOKEN_USD[token] ?? 1);
  const corridor = CORRIDORS.find((c) => c.currency === currency) ?? CORRIDORS[0];
  const payoutFee = Math.max(1, usdValue * 0.01);
  const platformFee = usdValue * 0.005;
  const totalFee = payoutFee + platformFee;
  const netUsdc = Math.max(0, usdValue - totalFee);
  const recipientAmount = netUsdc * corridor.rate;
  return {
    usdValue,
    usdcSettlement: usdValue,
    fxRate: corridor.rate,
    payoutFee,
    platformFee,
    totalFee,
    recipientAmount,
    corridor,
  };
}

export function fmt(n: number, digits = 2) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
