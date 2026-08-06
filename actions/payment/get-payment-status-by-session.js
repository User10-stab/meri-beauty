"use server";

import { getPaymentStatus } from "@/lib/payment-status";

/**
 * Server action used by the success page to poll for the webhook result.
 *
 * The page calls this on an interval after Stripe redirects the customer
 * back. The webhook is the only thing that updates the payment — we just
 * read the DB state here and return it.
 *
 * Never modifies the database.
 *
 * @param {string} stripeSessionId
 * @returns {Promise<{ found: boolean, data: import("@/lib/payment-status").PaymentStatusResult | null }>}
 */
export async function getPaymentStatusBySession(stripeSessionId) {
  if (!stripeSessionId || typeof stripeSessionId !== "string") {
    return { found: false, data: null };
  }

  try {
    const data = await getPaymentStatus({ stripeSessionId: stripeSessionId.trim() });
    return { found: Boolean(data), data };
  } catch (error) {
    console.error("[getPaymentStatusBySession]", error);
    return { found: false, data: null };
  }
}
