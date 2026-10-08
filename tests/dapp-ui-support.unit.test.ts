/** Support code for the /pay UI: payout-country configuration and the shared wallet state. */
import { describe, expect, it } from "vitest";

import {
  configuredPayoutCountries,
  DEFAULT_PAYOUT_COUNTRIES,
  payoutCountriesFrom,
  TEST_MODE_PAYOUT_COUNTRIES,
} from "@/lib/payout-countries";
import { getAppWallet, requestWalletConnect, setAppWallet } from "@/lib/wallet-state";

describe("payout countries", () => {
  it("TEST MODE defaults to the destinations the partner's sandbox completes", () => {
    const list = configuredPayoutCountries(undefined, "test");
    expect(list.map((c) => c.code)).toEqual(TEST_MODE_PAYOUT_COUNTRIES);
    expect(list.map((c) => c.currency)).toEqual(["USD", "GBP", "INR", "PHP"]);
    // An explicit PAYOUT_COUNTRIES still wins in TEST MODE.
    expect(configuredPayoutCountries("NG,KE", "test").map((c) => c.code)).toEqual(["NG", "KE"]);
  });

  it("defaults to the Stables dashboard currencies LamportPay can pay out (LIVE)", () => {
    const list = configuredPayoutCountries(undefined);
    expect(list.map((c) => c.code)).toEqual(DEFAULT_PAYOUT_COUNTRIES);
    // CNY is in Stables' list but needs trade documents: not offered.
    expect(list.map((c) => c.code)).not.toContain("CN");
    expect(list.map((c) => c.currency)).toEqual([
      "ARS",
      "AUD",
      "BRL",
      "COP",
      "GBP",
      "GHS",
      "INR",
      "KES",
      "MXN",
      "NGN",
      "PHP",
      "RWF",
      "TZS",
      "UGX",
      "USD",
      "XAF",
      "XOF",
      "ZAR",
      "ZMW",
    ]);
    // Not in Stables' list: never offered.
    for (const other of ["PK", "SA", "AE", "CA", "DE", "SG", "EU", "JP"]) {
      expect(list.map((c) => c.code)).not.toContain(other);
    }
  });

  it("has a minimal bank form for every offered country (fields from Stables' validation)", async () => {
    const { payoutFormFor } = await import("@/lib/payout-requirements");
    for (const c of configuredPayoutCountries(undefined)) {
      expect(payoutFormFor(c.currency), c.currency).not.toBeNull();
    }
    expect(payoutFormFor("CNY")).toBeNull();
    // Address only where Stables requires it.
    const withAddress = configuredPayoutCountries(undefined)
      .filter((c) => payoutFormFor(c.currency)!.extra.includes("address"))
      .map((c) => c.currency);
    expect(withAddress).toEqual(["GBP", "INR", "MXN", "USD"]);
    expect(payoutFormFor("NGN")!.extra).toEqual(["phone"]);
    expect(payoutFormFor("GBP")!.extra).toEqual(["sort_code", "address"]);
  });

  it("uses PAYOUT_COUNTRIES when set, dropping unknown or duplicate codes", () => {
    expect(configuredPayoutCountries("au, gb ,GB,zz,123")).toEqual([
      { code: "AU", currency: "AUD" },
      { code: "GB", currency: "GBP" },
    ]);
    // Nothing usable → the default, never an empty picker.
    expect(configuredPayoutCountries("zz")).toEqual(payoutCountriesFrom(DEFAULT_PAYOUT_COUNTRIES));
  });
});

describe("shared app wallet state", () => {
  it("publishes the header's connected key and counts connect requests", () => {
    expect(getAppWallet()).toMatchObject({ publicKey: null, ready: false, openRequest: 0 });
    setAppWallet({ publicKey: "Key111", walletName: "Phantom", ready: true });
    expect(getAppWallet()).toMatchObject({ publicKey: "Key111", walletName: "Phantom" });
    const before = getAppWallet();
    setAppWallet({ publicKey: "Key111" }); // no change → same snapshot (no re-render)
    expect(getAppWallet()).toBe(before);
    requestWalletConnect();
    requestWalletConnect();
    expect(getAppWallet().openRequest).toBe(2);
    setAppWallet({ publicKey: null });
    expect(getAppWallet().publicKey).toBeNull();
  });
});
