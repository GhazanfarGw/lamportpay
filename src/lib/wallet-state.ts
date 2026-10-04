/**
 * The app header's wallet connection, shared with the page (/pay) without a
 * second connect UI. The header's wallet island publishes the connected public
 * key here; pages read it. Connecting shares only the public key; nothing is
 * signed. SSR-safe: on the server the state is always "not connected".
 */
import { useSyncExternalStore } from "react";

export type AppWalletState = {
  /** Base58 public key of the connected wallet, or null. */
  publicKey: string | null;
  walletName: string | null;
  connecting: boolean;
  /** False until the header's wallet island has loaded in the browser. */
  ready: boolean;
  /** Increments when a page asks the header to open the wallet picker. */
  openRequest: number;
  /** Increments when a page asks to sign in to LamportPay with the wallet. */
  signInRequest: number;
  /** False when the wallet picker is already open (the user just picked a wallet). */
  signInOpensPicker: boolean;
  /** Progress of "Sign in with wallet" (a message signature; no funds move). */
  signIn: WalletSignInState;
};

export type WalletSignInState = {
  phase: "idle" | "connecting" | "signing" | "error";
  error: string | null;
};

const INITIAL: AppWalletState = {
  publicKey: null,
  walletName: null,
  connecting: false,
  ready: false,
  openRequest: 0,
  signInRequest: 0,
  signInOpensPicker: true,
  signIn: { phase: "idle", error: null },
};

let state = INITIAL;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setAppWallet(
  patch: Partial<
    Omit<AppWalletState, "openRequest" | "signInRequest" | "signInOpensPicker" | "signIn">
  >,
): void {
  const next = { ...state, ...patch };
  if (
    next.publicKey === state.publicKey &&
    next.walletName === state.walletName &&
    next.connecting === state.connecting &&
    next.ready === state.ready
  ) {
    return;
  }
  state = next;
  emit();
}

/** Ask the header to open its wallet picker (used when an action needs a wallet). */
export function requestWalletConnect(): void {
  state = { ...state, openRequest: state.openRequest + 1 };
  emit();
}

/**
 * Ask the header wallet to sign in to LamportPay: connect if needed, then sign
 * a one-line message (no transaction, no funds). Needs the wallet island mounted.
 */
export function requestWalletSignIn(options: { openPicker?: boolean } = {}): void {
  state = {
    ...state,
    signInRequest: state.signInRequest + 1,
    signInOpensPicker: options.openPicker ?? true,
    signIn: { phase: "connecting", error: null },
  };
  emit();
}

export function setWalletSignIn(signIn: WalletSignInState): void {
  if (state.signIn.phase === signIn.phase && state.signIn.error === signIn.error) return;
  state = { ...state, signIn };
  emit();
}

/** Current snapshot (outside React). */
export function getAppWallet(): AppWalletState {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppWallet(): AppWalletState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL,
  );
}
