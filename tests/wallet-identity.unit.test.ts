import { describe, expect, it } from "vitest";

import { kycStateOf } from "@/lib/identity/kyc-state";
import { walletAddressesOf, walletLinkOf } from "@/lib/identity/wallet-identity";
import { isWalletRejection, walletActionErrorMessage } from "@/lib/wallet-sign-in";

const A = "97N43KfdSgPZF66hMnDk1EbJa3HZDKw3UJYoXcSTK5r6";
const B = "So11111111111111111111111111111111111111112";

describe("wallet identity (Supabase web3 identities)", () => {
  it("reads Solana wallets only from web3 identities", () => {
    expect(
      walletAddressesOf([
        { provider: "email", id: "x" },
        { provider: "web3", id: `web3:solana:${A}` },
        { provider: "web3", id: null, identity_data: { sub: `web3:solana:${B}` } },
        { provider: "web3", id: `web3:solana:${A}` },
      ]),
    ).toEqual([A, B]);
  });

  it("ignores malformed or non-Solana identities", () => {
    expect(
      walletAddressesOf([
        { provider: "web3", id: "web3:ethereum:0xabc" },
        { provider: "web3", id: "web3:solana:not-base58-0OIl" },
        { provider: "google", id: `web3:solana:${A}` },
      ]),
    ).toEqual([]);
    expect(walletAddressesOf(undefined)).toEqual([]);
  });

  it("classifies the connected wallet against the account", () => {
    expect(walletLinkOf(null, [A])).toBe("no_wallet");
    expect(walletLinkOf(A, [])).toBe("email_account");
    expect(walletLinkOf(A, [A])).toBe("linked");
    expect(walletLinkOf(B, [A])).toBe("different_wallet");
  });
});

describe("KYC state (from Stables' stored answers only)", () => {
  const s = (registered: boolean, v: string | null, p: string | null) =>
    kycStateOf({ registered, verificationStatus: v, basePayoutStatus: p });

  it("maps every stored combination", () => {
    expect(s(false, null, null)).toBe("not_registered");
    expect(s(true, "in_progress", "pending")).toBe("kyc_pending");
    expect(s(true, "approved", "in_progress")).toBe("kyc_pending");
    expect(s(true, "approved", "approved")).toBe("kyc_verified");
    expect(s(true, "requires_action", null)).toBe("kyc_action_required");
    expect(s(true, "rejected", null)).toBe("kyc_rejected");
    expect(s(true, "approved", "rejected")).toBe("kyc_rejected");
  });

  it("is never verified without both approvals", () => {
    expect(s(true, "approved", null)).not.toBe("kyc_verified");
    expect(s(true, null, "approved")).not.toBe("kyc_verified");
  });
});

describe("wallet transaction errors", () => {
  it("says nothing moved when the user rejects in the wallet", () => {
    expect(isWalletRejection({ code: 4001, message: "x" })).toBe(true);
    expect(walletActionErrorMessage(new Error("User rejected the request."), "fallback")).toBe(
      "Transaction rejected. No funds were moved.",
    );
  });

  it("keeps other errors as they are", () => {
    expect(walletActionErrorMessage(new Error("Internal error"), "fallback")).toMatch(
      /internal error.*never counted twice/i,
    );
    expect(walletActionErrorMessage(new Error("Blockhash expired"), "fallback")).toBe(
      "Blockhash expired",
    );
    expect(walletActionErrorMessage({}, "fallback")).toBe("fallback");
  });
});
