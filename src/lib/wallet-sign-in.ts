/**
 * "Sign in with wallet" (Sign in with Solana, via Supabase Auth Web3). The user
 * signs one plain-text message in their wallet. It is not a transaction: no
 * funds move, no fee is paid, and no private key or seed phrase ever leaves
 * the wallet. Supabase verifies the signature and issues the session.
 */

/** One line only (Supabase rejects new lines in the statement). */
export const WALLET_SIGN_IN_STATEMENT =
  "Sign in to LamportPay. This proves you own this wallet. It is not a transaction and moves no funds.";

/** How long a sign-in waits for the wallet to connect before giving up. */
export const WALLET_CONNECT_TIMEOUT_MS = 60_000;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

/** The user declined in their wallet (Phantom/Solflare use code 4001 or "rejected"). */
export function isWalletRejection(error: unknown): boolean {
  const raw = messageOf(error).toLowerCase();
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return (
    code === 4001 || raw.includes("reject") || raw.includes("declined") || raw.includes("denied")
  );
}

/**
 * Message for a failed wallet TRANSACTION step (swap or payment). A rejection
 * in the wallet means nothing was signed, so nothing moved.
 */
export function walletActionErrorMessage(error: unknown, fallback: string): string {
  if (isWalletRejection(error)) return "Transaction rejected. No funds were moved.";
  const raw = messageOf(error);
  // Phantom/Solflare answer a bare "Internal error" when they could not send
  // (seen 3 Oct on devnet; a retry went through). The server never counts a
  // payment twice, so retrying is safe.
  if (/^internal error\.?$/i.test(raw.trim())) {
    return "Your wallet reported an internal error. Check that it is on the right network and try again; a payment is never counted twice.";
  }
  return raw || fallback;
}

/** A short, safe message for the user. Never echoes raw provider payloads. */
export function walletSignInErrorMessage(error: unknown): string {
  const raw = messageOf(error).toLowerCase();
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;

  if (code === 4001 || raw.includes("reject") || raw.includes("cancel") || raw.includes("denied")) {
    return "You cancelled the signature. Nothing was signed.";
  }
  if (
    raw.includes("does not support") ||
    raw.includes("signmessage") ||
    raw.includes("sign message")
  ) {
    return "This wallet cannot sign messages. Try Phantom or Solflare, or use email.";
  }
  if (raw.includes("signups not allowed") || raw.includes("signup")) {
    return "New accounts are not open yet. Please sign in with email.";
  }
  if (raw.includes("web3") || raw.includes("provider") || raw.includes("not enabled")) {
    return "Wallet sign-in is not switched on yet. Please sign in with email for now.";
  }
  if (raw.includes("timed out") || raw.includes("timeout")) {
    return "The wallet did not connect in time. Please try again.";
  }
  return "Wallet sign-in did not complete. Please try again.";
}
