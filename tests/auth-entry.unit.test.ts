import { describe, expect, it } from "vitest";

import { isAdminPath, safeAdminNext } from "@/lib/admin-path";
import { WALLET_SIGN_IN_STATEMENT, walletSignInErrorMessage } from "@/lib/wallet-sign-in";

const ORIGIN = "https://lamportpay.example";

describe("admin sign-in routing", () => {
  it("treats /admin pages as admin, but not the admin sign-in page itself", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/payments/abc")).toBe(true);
    expect(isAdminPath("/admin/login")).toBe(false);
    expect(isAdminPath("/administrator")).toBe(false);
    expect(isAdminPath("/pay")).toBe(false);
  });

  it("only returns to same-site admin pages after sign-in", () => {
    expect(safeAdminNext("/admin/settings", ORIGIN)).toBe("/admin/settings");
    expect(safeAdminNext("/admin/payments?status=x", ORIGIN)).toBe("/admin/payments?status=x");
    expect(safeAdminNext("https://evil.example/admin", ORIGIN)).toBe("/admin");
    expect(safeAdminNext("//evil.example/admin", ORIGIN)).toBe("/admin");
    expect(safeAdminNext("/pay", ORIGIN)).toBe("/admin");
    expect(safeAdminNext("/admin/login", ORIGIN)).toBe("/admin");
    expect(safeAdminNext(undefined, ORIGIN)).toBe("/admin");
  });
});

describe("sign in with wallet", () => {
  it("uses a one-line statement (Supabase rejects new lines)", () => {
    expect(WALLET_SIGN_IN_STATEMENT).not.toMatch(/[\r\n]/);
    expect(WALLET_SIGN_IN_STATEMENT).toMatch(/not a transaction/i);
  });

  it("maps wallet and provider errors to short, safe messages", () => {
    expect(walletSignInErrorMessage(new Error("User rejected the request."))).toMatch(/cancelled/);
    expect(walletSignInErrorMessage({ code: 4001, message: "x" })).toMatch(/cancelled/);
    expect(walletSignInErrorMessage({ message: "Web3 provider is disabled" })).toMatch(/email/);
    expect(walletSignInErrorMessage({ message: "Signups not allowed for this instance" })).toMatch(
      /not open/,
    );
    expect(walletSignInErrorMessage("timeout")).toMatch(/in time/);
    expect(walletSignInErrorMessage({ weird: true })).toBe(
      "Wallet sign-in did not complete. Please try again.",
    );
  });
});
