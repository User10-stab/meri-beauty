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
 * Privacy: the success page is reachable by anyone who has the Stripe
 * session id (it leaks via referrers, screenshots, support tickets). The
 * full PaymentStatusResult (lib/payment-status.js) includes the buyer's PII
 * (fullName/email/phone) and the staff user record — that data is needed by
 * the authenticated dashboard views, NOT by this public polling endpoint.
 * Strip it here so we only return what the success page actually renders:
 * status, amounts, appointment time, and the service/staff public info.
 *
 * @param {string} stripeSessionId
 * @returns {Promise<{ found: boolean, data: object | null }>}
 */
export async function getPaymentStatusBySession(stripeSessionId) {
  if (!stripeSessionId || typeof stripeSessionId !== "string") {
    return { found: false, data: null };
  }

  try {
    const full = await getPaymentStatus({ stripeSessionId: stripeSessionId.trim() });
    if (!full) return { found: false, data: null };

    // Return only the public-safe subset. Notably NOT included:
    // - customer (buyer's fullName/email/phone)
    // - staff.user (staff member's fullName/email/phone)
    // - transaction.stripePaymentIntentId / stripeCheckoutSessionId
    const { customer, staff, transactions, ...safe } = full;
    return {
      found: true,
      data: {
        ...safe,
        staff: staff
          ? {
              id: staff.id,
              reservationConfirmationMode: staff.reservationConfirmationMode,
            }
          : undefined,
      },
    };
  } catch (error) {
    console.error("[getPaymentStatusBySession]", error);
    return { found: false, data: null };
  }
}
