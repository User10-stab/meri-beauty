/**
 * Gives back the PromoCode.usedCount use a booking took (claimPromoCodeUse in
 * lib/promo-codes.js) once that booking is cancelled or rejected. Orders have
 * their own release points (lib/orders/*, lib/refunds/open-refund-operation.js);
 * this covers rendez-vous, ateliers/événements and formations. Call it inside
 * the transaction that flips the booking's status, right after the status
 * claim succeeds. Every cancellation path calls it:
 *
 *   rendez-vous
 *     staff cancel / reject          actions/appointment/manage-appointment.js
 *     customer self-cancel           actions/reservation/cancel-reservation.js
 *     stale PENDING expiry (cron)    lib/appointments/expire-stale-appointments.js
 *   ateliers / formations
 *     staff cancel                   actions/{workshops,formations}/manage-reservation.js
 *     Stripe checkout not created    actions/{workshops,formations}/create-*-reservation.js
 *     hold lapsed, seats resold      lib/{workshops,formations}/fulfill-*-payment.js
 *     hold expiry (cron)             lib/{workshops,formations}/expire-stale-holds.js
 *   all three
 *     exceptional full Stripe refund lib/payments/reconcile-reservation-refund.js
 *     refund operation (Opérations)  lib/refunds/open-refund-operation.js
 *
 * Keyed on a `promoUseClaimed` flag rather than on the status change alone:
 * bookings made before a use was claimed for them never took one (rendez-vous
 * before 2026-09-28, ateliers/formations before 2026-08-11), and giving one
 * back for them would free a use some other sale really took. Clearing the
 * flag in the same guarded statement also makes a second call (two
 * cancellation paths racing, a retry) a no-op.
 *
 * Any cancellation frees the use, a completed-then-cancelled one included —
 * the same rule countCustomerPromoUses applies to the per-customer cap.
 * A failed online payment on a rendez-vous does NOT: the customer can still
 * pay through the retry link, so it stays live until it is cancelled.
 *
 * Takes only the transaction client — no Prisma or "@/" import — so the
 * refund modules that call it stay loadable with a mocked `tx`.
 */

/** "WORKSHOP" | "FORMATION" → that reservation model's delegate. */
function reservationDelegate(tx, kind) {
  if (kind === "WORKSHOP") return tx.workshopReservation;
  if (kind === "FORMATION") return tx.formationReservation;
  throw new Error(`promo-code-release: unknown reservation kind "${kind}"`);
}

async function giveUseBack(tx, promoCodeId) {
  await tx.promoCode.updateMany({
    where: { id: promoCodeId, usedCount: { gt: 0 } },
    data: { usedCount: { decrement: 1 } },
  });
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} appointmentId
 */
export async function releaseAppointmentPromoUse(tx, appointmentId) {
  if (!appointmentId) return;
  const payment = await tx.payment.findUnique({
    where: { appointmentId },
    select: { id: true, promoCodeId: true, promoUseClaimed: true },
  });
  if (!payment?.promoCodeId || !payment.promoUseClaimed) return;

  const cleared = await tx.payment.updateMany({
    where: { id: payment.id, promoUseClaimed: true },
    data: { promoUseClaimed: false },
  });
  if (cleared.count === 0) return;

  await giveUseBack(tx, payment.promoCodeId);
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {"WORKSHOP"|"FORMATION"} kind
 * @param {string} reservationId
 */
export async function releaseReservationPromoUse(tx, kind, reservationId) {
  if (!reservationId) return;
  const delegate = reservationDelegate(tx, kind);
  const reservation = await delegate.findUnique({
    where: { id: reservationId },
    select: { promoCodeId: true, promoUseClaimed: true },
  });
  if (!reservation?.promoCodeId || !reservation.promoUseClaimed) return;

  const cleared = await delegate.updateMany({
    where: { id: reservationId, promoUseClaimed: true },
    data: { promoUseClaimed: false },
  });
  if (cleared.count === 0) return;

  await giveUseBack(tx, reservation.promoCodeId);
}

/**
 * A relance (actions/payments/resend-activity-payment.js) puts an expired
 * hold back on sale at its original, discounted price — so it takes the use
 * back too, if the expiry had given it up. Only the code's overall cap is
 * re-checked: the discount was granted at booking, and this is the same
 * customer's same booking, so an expiry date or the per-customer cap passed
 * since then does not withdraw it. Throws "PROMO_EXHAUSTED" when the code
 * has meanwhile been used up by others.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {"WORKSHOP"|"FORMATION"} kind
 * @param {string} reservationId
 */
export async function reclaimReservationPromoUse(tx, kind, reservationId) {
  if (!reservationId) return;
  const delegate = reservationDelegate(tx, kind);
  const reservation = await delegate.findUnique({
    where: { id: reservationId },
    select: { promoCodeId: true, promoUseClaimed: true },
  });
  if (!reservation?.promoCodeId || reservation.promoUseClaimed) return;

  const marked = await delegate.updateMany({
    where: { id: reservationId, promoUseClaimed: false },
    data: { promoUseClaimed: true },
  });
  if (marked.count === 0) return;

  // Prisma can't compare two columns in a where — raw, still one atomic
  // conditional statement like claimPromoCodeUse's.
  const taken = await tx.$executeRaw`
    UPDATE "PromoCode" SET "usedCount" = "usedCount" + 1
    WHERE id = ${reservation.promoCodeId} AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
  `;
  if (taken === 0) throw new Error("PROMO_EXHAUSTED");
}
