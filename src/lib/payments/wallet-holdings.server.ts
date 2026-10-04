/**
 * What the /pay app shows right after the wallet connects: the wallet's real
 * balances (read from Solana by the server, never trusted from the browser) and,
 * for each payment coin turned on, the most that can be converted once
 * LamportPay's fee is paid on top from the same balance.
 *
 * Read only: nothing is created, quoted or signed here. Provider costs are not
 * estimated: Stables' fee comes from its live quote, Jupiter's from its order.
 */
import {
  feeModelOf,
  getBusinessSettings,
  type BusinessSettings,
} from "@/lib/business-settings.server";
import { toMajor } from "@/lib/money";
import { maxConvertibleFor } from "@/lib/payments/fee-math";
import { readWalletHoldings, type WalletHoldings } from "@/lib/solana-balances.server";

export type WalletHoldingsView =
  | {
      status: "ok";
      wallet: string;
      readAt: string;
      sol: string;
      /** Balance per enabled payment coin, major units. */
      tokens: Record<string, string>;
      /** Most that can be converted per enabled coin, after LamportPay's fee. */
      maxConvertible: Record<string, string>;
      /** LamportPay's fee model: basis points (0 when off) and optional bounds (major units). */
      feeBps: number;
      feeMin: string | null;
      feeMax: string | null;
    }
  | { status: "unavailable"; wallet: string; reason: string };

export function holdingsView(
  holdings: WalletHoldings,
  settings: Pick<BusinessSettings, "conversionFeeBps" | "feeMin" | "feeMax" | "enabledCurrencies">,
): WalletHoldingsView {
  if (holdings.status !== "ok") {
    return {
      status: "unavailable",
      wallet: holdings.owner,
      reason: "We couldn't read your wallet balances. Please try again.",
    };
  }
  const model = feeModelOf(settings);
  const tokens: Record<string, string> = {};
  const maxConvertible: Record<string, string> = {};
  for (const coin of settings.enabledCurrencies) {
    const balance = holdings.tokens[coin] ?? 0n;
    tokens[coin] = toMajor(balance, coin);
    maxConvertible[coin] = toMajor(maxConvertibleFor(balance, model), coin);
  }
  return {
    status: "ok",
    wallet: holdings.owner,
    readAt: holdings.readAt,
    sol: toMajor(holdings.solLamports, "sol"),
    tokens,
    maxConvertible,
    feeBps: settings.conversionFeeBps,
    feeMin: settings.feeMin,
    feeMax: settings.feeMax,
  };
}

export async function getWalletHoldingsView(wallet: string): Promise<WalletHoldingsView> {
  const [holdings, settings] = await Promise.all([
    readWalletHoldings(wallet),
    getBusinessSettings(),
  ]);
  return holdingsView(holdings, settings);
}
