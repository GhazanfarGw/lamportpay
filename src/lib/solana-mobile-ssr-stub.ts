/**
 * SSR-only stub for @solana-mobile/wallet-adapter-mobile.
 *
 * The real package calls Node's `util.inherits` at module scope, which throws
 * inside the workerd SSR runtime ("superCtor.prototype must be of type object")
 * and made every server-rendered page return 500 in production.
 *
 * The mobile wallet adapter is browser-only anyway: it is never exercised
 * during SSR. This stub keeps the import graph resolvable on the server while
 * the real module is still used in the client bundle.
 */

export const SolanaMobileWalletAdapterWalletName =
  "Mobile Wallet Adapter" as const;
export const SolanaMobileWalletAdapterRemoteWalletName =
  "Remote Mobile Wallet Adapter" as const;

export const createDefaultAddressSelector = () => ({
  select: async (addresses: string[]) => addresses[0],
});

export const createDefaultAuthorizationResultCache = () => ({
  clear: async () => {},
  get: async () => undefined,
  set: async () => {},
});

export const createDefaultWalletNotFoundHandler = () => async () => {};

export class SolanaMobileWalletAdapter {
  constructor(..._args: unknown[]) {
    throw new Error(
      "SolanaMobileWalletAdapter is not available during server rendering.",
    );
  }
}

export class LocalSolanaMobileWalletAdapter extends SolanaMobileWalletAdapter {}
export class RemoteSolanaMobileWalletAdapter extends SolanaMobileWalletAdapter {}

export type AddressSelector = ReturnType<typeof createDefaultAddressSelector>;
export type AuthorizationResultCache = ReturnType<
  typeof createDefaultAuthorizationResultCache
>;
