"use client";

import { useEffect } from "react";

/**
 * The success page independently confirms payment via stripe.checkout.
 * sessions.retrieve — by the time it renders "paid", the order is real
 * regardless of whether the checkout.session.completed webhook (which is
 * what actually converts the cart server-side, see fulfillOrderPayment)
 * has landed yet. Without this, the header badge — mounted fresh on this
 * hard-navigated page, but racing that webhook — can read the cart before
 * it's converted and get stuck showing stale items indefinitely, since
 * nothing else ever re-fetches it afterwards.
 */
export function CartClearedNotifier() {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("boutique:cart-updated", { detail: { itemCount: 0 } }));
  }, []);

  return null;
}
