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
 * @param {string} paymentId
 * @returns {Promise<{ found: boolean, data: object | null }>}
 */
export async function getPaymentStatusBySession(stripeSessionId, paymentId) {
  if (!stripeSessionId && !paymentId) {
    return { found: false, data: null };
  }

  try {
    let full;
    
    // Try to find by session ID first (the primary lookup)
    if (stripeSessionId && typeof stripeSessionId === "string") {
      full = await getPaymentStatus({ stripeSessionId: stripeSessionId.trim() });
    }
    
    // Fallback to payment ID if session lookup failed
    if (!full && paymentId && typeof paymentId === "string") {
      full = await getPaymentStatus({ paymentId: paymentId.trim() });
    }
    
    if (!full) return { found: false, data: null };

    // Return only the public-safe subset. Notably NOT included:
    // - customer (buyer's fullName/email/phone)
    // - staff.user (staff member's fullName/email/phone)
    // - transaction.stripePaymentIntentId / stripeCheckoutSessionId
    return {
      found: true,
      data: {
        payment: {
          totalAmount: full.payment.totalAmount,
          paidAmount: full.payment.paidAmount,
          remainingAmount: full.payment.remainingAmount,
          paymentType: full.payment.paymentType,
          status: full.payment.status,
          paidAt: full.payment.paidAt,
        },
        appointment: {
          date: full.appointment.date,
          startTime: full.appointment.startTime,
          endTime: full.appointment.endTime,
          status: full.appointment.status,
        },
        staff: {
          reservationConfirmationMode: full.staff.reservationConfirmationMode,
          user: { fullName: full.staff.user.fullName },
        },
        service: { name: full.service.name },
        staffService: {
          price: full.staffService.price,
          duration: full.staffService.duration,
        },
        transactions: [],
      },
    };
  } catch (error) {
    console.error("[getPaymentStatusBySession]", error);
    return { found: false, data: null };
  }
}
