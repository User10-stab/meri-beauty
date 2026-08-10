const ADMIN_EXTERNAL_REFUND = "ADMIN_EXTERNAL_STRIPE_REFUND";
const FULL_REFUND_EPSILON = 0.01;

/**
 * `paidAmount` is immutable gross cash collected. Refunds are separate ledger
 * entries; callers that display revenue must use `netCollectedAmount` below.
 */
export function summarizePaymentAmounts(payment) {
  const grossPaidAmount = Number(payment?.paidAmount ?? 0);
  const refundedAmount = (payment?.transactions ?? [])
    .filter((transaction) => transaction.transactionType === "REFUND")
    .reduce((total, transaction) => total + Number(transaction.amount ?? 0), 0);

  return {
    grossPaidAmount,
    refundedAmount,
    netCollectedAmount: Math.max(0, Math.round((grossPaidAmount - refundedAmount) * 100) / 100),
  };
}

/**
 * Reconciles an exceptional, admin-authorized Stripe refund with workshop or
 * formation capacity. Deposits remain non-refundable by policy; this helper
 * must only be called by the trusted external-refund webhook path after a
 * staff member deliberately granted an exception in Stripe.
 *
 * Capacity is derived from CONFIRMED reservations, so the atomic transition
 * to CANCELLED releases `seatsCount` without mutating a separate counter.
 * `updateMany` makes Stripe's at-least-once webhook replay harmless.
 */
export async function reconcileExceptionalReservationFullRefund(
  tx,
  {
    payment,
    stripeRefundedTotal,
    authorization,
    refundedAt = new Date(),
  },
) {
  if (authorization !== ADMIN_EXTERNAL_REFUND) {
    return { reconciled: false, reason: "admin-authorization-required", releasedSeats: 0 };
  }

  const grossPaidAmount = Number(payment?.paidAmount ?? 0);
  const refundedAmount = Number(stripeRefundedTotal ?? 0);
  const fullyRefunded =
    grossPaidAmount > 0 && refundedAmount + FULL_REFUND_EPSILON >= grossPaidAmount;

  if (!fullyRefunded) {
    return { reconciled: false, reason: "partial-refund", releasedSeats: 0 };
  }

  const reservation = payment?.workshopReservation ?? payment?.formationReservation;
  const reservationKind = payment?.workshopReservation
    ? "workshop"
    : payment?.formationReservation
      ? "formation"
      : null;

  if (!reservation || !reservationKind) {
    return { reconciled: false, reason: "not-a-capacity-reservation", releasedSeats: 0 };
  }

  const model = reservationKind === "workshop"
    ? tx.workshopReservation
    : tx.formationReservation;
  const policyNote =
    "Annulation automatique apres remboursement integral Stripe autorise exceptionnellement par un administrateur. " +
    "Le montant paye reste le brut historique; le revenu net deduit les transactions REFUND.";
  const notes = reservation.notes ? `${reservation.notes}\n${policyNote}` : policyNote;

  const claim = await model.updateMany({
    where: { id: reservation.id, status: "CONFIRMED" },
    data: {
      status: "CANCELLED",
      cancelledAt: refundedAt,
      notes,
    },
  });

  if (claim.count === 0) {
    return { reconciled: false, reason: "already-released-or-not-confirmed", releasedSeats: 0 };
  }

  return {
    reconciled: true,
    reason: "admin-exception-full-refund",
    reservationKind,
    reservationId: reservation.id,
    sessionId: reservation.sessionId,
    releasedSeats: Number(reservation.seatsCount ?? 1),
  };
}

export const RESERVATION_REFUND_AUTHORIZATION = Object.freeze({
  ADMIN_EXTERNAL_STRIPE_REFUND: ADMIN_EXTERNAL_REFUND,
});
