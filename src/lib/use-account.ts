/**
 * The signed-in LamportPay account, as the browser sees it (for UX only; every
 * server route re-verifies the session and the wallet identity itself).
 */
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { walletAddressesOf } from "@/lib/identity/wallet-identity";

export type AccountState =
  | { status: "loading" }
  | { status: "signed_out" }
  | {
      status: "signed_in";
      userId: string;
      /** Wallets this account signed in with (Supabase web3 identities). */
      wallets: string[];
      hasEmail: boolean;
    };

export function accountOf(session: Session | null): AccountState {
  if (!session?.user) return { status: "signed_out" };
  return {
    status: "signed_in",
    userId: session.user.id,
    wallets: walletAddressesOf(session.user.identities),
    hasEmail: Boolean(session.user.email),
  };
}

export function useAccount(): AccountState {
  const [account, setAccount] = useState<AccountState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setAccount(accountOf(data.session));
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setAccount(accountOf(session));
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return account;
}
