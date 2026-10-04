import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Swapping is part of the conversion journey on /pay: when the wallet lacks
 * USDC, the payment offers a Jupiter swap for the missing amount (signed by
 * the user in their own wallet) and continues to the Stables payment.
 *
 * /swap is kept only so old links and bookmarks still work; it goes to /pay.
 * The standalone swap API (/api/jupiter/order, /execute) stays authenticated
 * and unchanged but has no page of its own any more.
 */
export const Route = createFileRoute("/swap")({
  beforeLoad: () => {
    throw redirect({ to: "/pay", replace: true });
  },
});
