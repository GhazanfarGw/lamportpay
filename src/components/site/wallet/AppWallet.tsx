/**
 * The dApp header's wallet control: the connect button / connected-wallet menu,
 * plus bridges that share the connection with the page (lib/wallet-state) and
 * run "Sign in with wallet" when a page asks for it.
 * Loaded only in the browser, inside the wallet providers.
 */
import "@/lib/buffer-polyfill";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useWallet } from "@solana/wallet-adapter-react";

import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/use-account";
import {
  requestWalletConnect,
  requestWalletSignIn,
  setAppWallet,
  setWalletSignIn,
  useAppWallet,
} from "@/lib/wallet-state";
import {
  WALLET_CONNECT_TIMEOUT_MS,
  WALLET_SIGN_IN_STATEMENT,
  walletSignInErrorMessage,
} from "@/lib/wallet-sign-in";
import { WalletConnectButton } from "./SolanaWallet";

function WalletStateBridge() {
  const { publicKey, wallet, connected, connecting } = useWallet();
  const address = connected && publicKey ? publicKey.toBase58() : null;
  const name = wallet?.adapter.name ?? null;
  useEffect(() => {
    setAppWallet({ publicKey: address, walletName: name, connecting, ready: true });
  }, [address, name, connecting]);
  useEffect(() => () => setAppWallet({ publicKey: null, connecting: false, ready: false }), []);
  return null;
}

/**
 * Sign in with Solana: connect if needed, then ask the wallet to sign one
 * plain-text message. Supabase verifies it and starts the session. Only a
 * signature over a message is requested: never a transaction, key or seed.
 */
function WalletSignInBridge() {
  const { publicKey, connected, signMessage } = useWallet();
  const { signInRequest, signInOpensPicker } = useAppWallet();
  const handled = useRef(0);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  // A new request: remember it, and open the wallet picker if not connected
  // (unless the user is already picking a wallet).
  useEffect(() => {
    if (signInRequest === 0 || signInRequest === handled.current) return;
    handled.current = signInRequest;
    setPending(true);
    if (!connected && signInOpensPicker) requestWalletConnect();
  }, [signInRequest, signInOpensPicker, connected]);

  // Give up if the wallet never connects (picker closed, wallet not installed).
  useEffect(() => {
    if (!pending || connected) return;
    const timer = setTimeout(() => {
      setPending(false);
      setWalletSignIn({ phase: "error", error: walletSignInErrorMessage("timeout") });
    }, WALLET_CONNECT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pending, connected]);

  // Connected: sign the message once.
  useEffect(() => {
    if (!pending || !connected || !publicKey || inFlight.current) return;
    setPending(false);
    if (!signMessage) {
      setWalletSignIn({ phase: "error", error: walletSignInErrorMessage("does not support") });
      return;
    }
    inFlight.current = true;
    setWalletSignIn({ phase: "signing", error: null });
    supabase.auth
      .signInWithWeb3({
        chain: "solana",
        statement: WALLET_SIGN_IN_STATEMENT,
        wallet: { publicKey, signMessage },
      })
      .then(({ error }) => {
        setWalletSignIn(
          error
            ? { phase: "error", error: walletSignInErrorMessage(error) }
            : { phase: "idle", error: null },
        );
      })
      .catch((error: unknown) => {
        setWalletSignIn({ phase: "error", error: walletSignInErrorMessage(error) });
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [pending, connected, publicKey, signMessage]);

  return null;
}

/**
 * Wallet-first: when a signed-out user picks a wallet in the app, connecting
 * and verifying are one step. After the wallet connects, it asks for one
 * message signature (never a transaction); cancelling leaves the wallet
 * connected and the user signed out.
 */
export function AppWalletControl() {
  const { openRequest } = useAppWallet();
  const account = useAccount();
  const signedOut = account.status === "signed_out";
  const onPick = useCallback(() => {
    if (signedOut) requestWalletSignIn({ openPicker: false });
  }, [signedOut]);
  return (
    <>
      <WalletStateBridge />
      <WalletSignInBridge />
      <WalletConnectButton
        openRequest={openRequest}
        onPick={onPick}
        pickerFooter={
          signedOut ? (
            <div className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
              Next, sign one message to verify the wallet is yours. No funds move.{" "}
              <Link
                to="/auth"
                search={{ next: currentPath() }}
                className="text-primary hover:underline"
              >
                Email account?
              </Link>
            </div>
          ) : null
        }
      />
    </>
  );
}

function currentPath() {
  return typeof window === "undefined"
    ? "/pay"
    : `${window.location.pathname}${window.location.search}`;
}

export default AppWalletControl;
