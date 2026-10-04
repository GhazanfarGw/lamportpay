/**
 * Token icons for the conversion app: the official logos, served from
 * /public/tokens (copied from @web3icons/core, MIT — see public/tokens/LICENSE.txt).
 * Nothing is loaded from a third party. A token without a logo file (or one
 * that fails to load) shows a neutral badge with its first letter.
 */
import { useState } from "react";

/** Tokens with an official logo in /public/tokens. */
const LOGOS = new Set(["sol", "usdc", "usdt"]);

const LABELS: Record<string, string> = { sol: "Solana", usdc: "USD Coin", usdt: "Tether USD" };

export function TokenIcon({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const key = symbol.toLowerCase();
  const [failed, setFailed] = useState(false);
  if (LOGOS.has(key) && !failed) {
    return (
      <img
        src={`/tokens/${key}.svg`}
        // Decorative: the token's symbol is always written next to the logo.
        alt=""
        aria-hidden
        title={LABELS[key]}
        width={size}
        height={size}
        decoding="async"
        draggable={false}
        className="rounded-full shrink-0 ring-2 ring-background shadow-sm"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-grid place-items-center rounded-full shrink-0 font-bold select-none ring-2 ring-background shadow-sm bg-muted text-foreground"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.48), lineHeight: 1 }}
    >
      {symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}
