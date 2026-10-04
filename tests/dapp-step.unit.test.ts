/**
 * The /pay journey rail must move past "Sign" (Approve in your wallet) once the
 * payment was detected, even while Stables still reports the transfer as
 * waiting for funds (3 Oct 2026: the rail stayed on "Approve in your wallet").
 */
import { describe, expect, it } from "vitest";

import { DAPP_STEPS, dappStepFor } from "@/components/app/PaymentJourney";
import type { PaymentView } from "@/lib/payments/view";

const view = (over: Partial<PaymentView>) =>
  ({
    status: "CREATED",
    funding: null,
    testPayment: null,
    transferId: "tr_1",
    ...over,
  }) as PaymentView;

const SIGN = DAPP_STEPS.indexOf("Sign");
const PROCESSING = DAPP_STEPS.indexOf("Processing");

describe("payment journey step", () => {
  it("asks for the wallet approval while nothing was sent", () => {
    expect(dappStepFor(view({}))).toBe(SIGN);
  });

  it("moves to Processing once the TEST MODE devnet payment is detected", () => {
    const detected = { signature: "sig", wallet: "w", explorerUrl: "u", detectedAt: "now" };
    expect(dappStepFor(view({ testPayment: detected as PaymentView["testPayment"] }))).toBe(
      PROCESSING,
    );
  });

  it("follows Stables: processing states and completion", () => {
    expect(dappStepFor(view({ status: "IN_PROGRESS" }))).toBe(PROCESSING);
    expect(dappStepFor(view({ status: "COMPLETED" }))).toBe(DAPP_STEPS.length);
  });
});
