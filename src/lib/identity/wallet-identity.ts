/**
 * Wallet-first identity. A customer signs in with their Solana wallet (Sign in
 * with Solana via Supabase Auth). Supabase verifies the signature and stores
 * the wallet as an auth identity: provider "web3", id "web3:solana:<address>".
 *
 * Identities are written by Supabase Auth only. user_metadata is NOT used here
 * because a signed-in user can edit their own metadata.
 *
 * A linked wallet proves who the user is. It never proves KYC: verification
 * comes only from Stables' answers stored in stables_customers.
 */

const WEB3_SOLANA_PREFIX = "web3:solana:";
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type AuthIdentityLike = {
  provider?: string | null;
  id?: string | null;
  identity_data?: Record<string, unknown> | null;
};

function addressFrom(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(WEB3_SOLANA_PREFIX)) return null;
  const address = value.slice(WEB3_SOLANA_PREFIX.length);
  return BASE58_ADDRESS.test(address) ? address : null;
}

/** Solana wallet addresses Supabase Auth has verified for this user (deduplicated). */
export function walletAddressesOf(
  identities: readonly AuthIdentityLike[] | null | undefined,
): string[] {
  const out = new Set<string>();
  for (const identity of identities ?? []) {
    if (identity?.provider !== "web3") continue;
    const address = addressFrom(identity.id) ?? addressFrom(identity.identity_data?.["sub"]);
    if (address) out.add(address);
  }
  return [...out];
}

/**
 * How the connected wallet relates to the signed-in account.
 * - "no_wallet": no wallet connected
 * - "email_account": signed in with email (no wallet identity); any wallet may be used
 * - "linked": the connected wallet is the one this account signed in with
 * - "different_wallet": signed in with another wallet; never treat as the same identity
 */
export type WalletLink = "no_wallet" | "email_account" | "linked" | "different_wallet";

export function walletLinkOf(
  connected: string | null,
  linkedWallets: readonly string[],
): WalletLink {
  if (!connected) return "no_wallet";
  if (linkedWallets.length === 0) return "email_account";
  return linkedWallets.includes(connected) ? "linked" : "different_wallet";
}
