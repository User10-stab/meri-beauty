import { prisma } from "@/lib/prisma";
import { createNotification, getSalonAdminNotificationRecipients } from "@/lib/notifications";
import { captureCriticalError } from "@/lib/monitoring";
import { isForeignCheckoutSession, getDeploymentId, DEPLOYMENT_METADATA_KEY } from "@/lib/stripe-deployment";

/**
 * Replaces every automatic Stripe refund in the app (2 Sep 2026 decision):
 * a Checkout Session that cleared for something the salon can no longer
 * honor (a deleted/cancelled reservation, an underpayment, an appointment
 * cancelled mid-payment, a stray duplicate charge, capacity exceeded, …) no
 * longer gets refunded by code — it gets flagged, and a human refunds it
 * from the Stripe Dashboard directly.
 *
 * This replaced two incidents' worth of automatic refunding gone wrong:
 * - 31 Aug 2026: two developers sharing one Stripe test key had their
 *   payments cross-refunded by each other's "no matching record → refund"
 *   safety net (see isForeignCheckoutSession — that guard stays below).
 * - 1 Sep 2026: reconcileMissedCheckouts replayed an old paid session whose
 *   reservation had been wiped by an unrelated (now-fixed) CASCADE bug, and
 *   refunded a real customer twice with zero local trace.
 *
 * Every one of the ~16 call sites this used to reach via refundSession()
 * (the live webhook's several failed-sale branches, and both activity
 * confirm functions) now funnels through here instead — a single choke
 * point instead of an option threaded through each call site, so nothing
 * can accidentally keep auto-refunding.
 */
export async function flagPaymentForManualRefund(session, reason, { stripeAccountId = null } = {}) {
  if (!session.payment_intent) return; // synthetic zero-total session — nothing was ever charged

  // Never let our own admins be notified about a payment that isn't even
  // ours — the webhook already drops foreign sessions before dispatch; this
  // is the same belt-and-braces guard refundSession used to carry.
  if (isForeignCheckoutSession(session)) {
    const err = new Error(
      `Refused to flag Checkout Session ${session.id} for refund: created by deployment ` +
        `"${session.metadata?.[DEPLOYMENT_METADATA_KEY]}", this is "${getDeploymentId()}"`
    );
    console.error("[flagPaymentForManualRefund]", err.message);
    captureCriticalError(err, { area: "refund-reconciliation", sessionId: session.id, kind: session.metadata?.kind });
    return;
  }

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const actionUrl = `https://dashboard.stripe.com/payments/${paymentIntentId}`;

  const amount = Number(((session.amount_total ?? 0) / 100).toFixed(2));
  const email = (session.customer_details?.email ?? session.customer_email ?? "—").slice(0, 200);

  // Notifications are deliberately not the record of money owed: they can
  // be read or dismissed, and historically left captured payments with no
  // amount-bearing row at all. Create the durable case first and use its
  // unique Stripe references as the replay/deduplication boundary.
  const existingCase = await prisma.manualRefundCase.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { id: true },
  });
  if (existingCase) return;

  try {
    await prisma.manualRefundCase.create({
      data: {
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
        stripeAccountId: stripeAccountId ?? session.metadata?.stripeAccountId ?? null,
        amount,
        currency: session.currency ?? "eur",
        reason,
      },
    });
  } catch (error) {
    // A concurrent webhook/reconciliation pass won the unique insert. It
    // already created the durable case and will create the alert for it.
    if (error?.code === "P2002") return;
    throw error;
  }

  // Reprocessing the same session (a Stripe webhook retry, a reconciliation
  // job re-scanning the same 72h window every 5 minutes) must never spam
  // every admin again — flag once, not forever.
  const already = await prisma.notification.findFirst({
    where: { type: "GENERAL", actionUrl },
    select: { id: true },
  });
  if (already) return;

  const recipientIds = await getSalonAdminNotificationRecipients();
  await Promise.all(
    recipientIds.map((userId) =>
      createNotification({
        userId,
        type: "GENERAL",
        title: "Remboursement manuel requis — paiement Stripe",
        message: `Un paiement de €${amount} (${email}) ne peut pas être honoré — ${reason}. Le remboursement automatique est désactivé : ouvrez la fiche Stripe pour le traiter vous-même.`,
        actionUrl,
      })
    )
  );

  captureCriticalError(new Error(`Payment flagged for manual refund: ${session.id} (${reason})`), {
    area: "refund-reconciliation",
    sessionId: session.id,
    paymentIntentId,
    reason,
  });
}
