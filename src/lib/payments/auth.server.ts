/**
 * Bearer-token authentication for the payment API routes. The browser sends
 * the signed-in user's Supabase access token; the server verifies it with
 * Supabase Auth before touching any payment.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { walletAddressesOf } from "@/lib/identity/wallet-identity";

export type AuthenticatedUser = {
  id: string;
  email: string | null;
  /**
   * Solana wallets this account signed in with, as verified by Supabase Auth
   * (web3 identities). Empty for email accounts. Optional so internal callers
   * and tests can omit it (treated as no linked wallet).
   */
  wallets?: string[];
};

export async function authenticateUser(
  request: Request,
): Promise<{ user: AuthenticatedUser; denied: null } | { user: null; denied: Response }> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  const denied = (message: string) => ({
    user: null,
    denied: Response.json({ error: message }, { status: 401 }),
  });

  if (!token || token.split(".").length !== 3) return denied("Sign in to continue.");

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return denied("Your session has expired. Sign in again.");

  return {
    user: {
      id: data.user.id,
      email: data.user.email || null,
      wallets: walletAddressesOf(data.user.identities),
    },
    denied: null,
  };
}
