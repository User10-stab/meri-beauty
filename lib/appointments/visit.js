/**
 * A visit: the prestations one client booked together from the dashboard
 * (model AppointmentVisit). Each prestation is its own Appointment; these
 * helpers are what lets the screens and the documents treat them as one.
 *
 * Kept out of any "use server" file — plain synchronous helpers and Prisma
 * `select` shapes, shared by the calendar, the appointments list, the
 * completion action and the ticket/cash-book labels.
 */

/** Every prestation of an appointment's visit, in the order they happen. */
export const VISIT_SELECT = {
  select: {
    id: true,
    appointments: {
      where: { isDeleted: false },
      orderBy: { startTime: "asc" },
      select: {
        id: true,
        staffId: true,
        startTime: true,
        endTime: true,
        status: true,
        coveredByPaymentId: true,
        staffService: {
          select: {
            price: true,
            service: { select: { name: true } },
            staff: { select: { user: { select: { fullName: true } } } },
          },
        },
        payment: { select: { status: true, paymentType: true, totalAmount: true, paidAmount: true } },
      },
    },
  },
};

/** What the counter would still collect for one prestation. */
function prestationAmountDue(appointment) {
  if (appointment.status !== "CONFIRMED" || appointment.coveredByPaymentId) return 0;
  const price = Number(appointment.staffService?.price ?? 0);
  const payment = appointment.payment;
  if (!payment) return price;
  const owesAtCounter =
    payment.status === "PARTIALLY_PAID" || (payment.status === "PENDING" && payment.paymentType === "ON_SITE");
  return owesAtCounter ? Math.max(0, Number(payment.totalAmount) - Number(payment.paidAmount)) : 0;
}

/**
 * The visit as the dashboard shows it, or null for an appointment booked on
 * its own.
 *
 * A staff member only ever sees her own prestations of a visit: another
 * practitioner's sale is hers (lib/payments/resolve-payee.js), and its price
 * is not this reader's business.
 *
 * `completable` is the same rule completeAppointment enforces: confirmed, and
 * already started — a prestation that has not happened yet is never cashed.
 *
 * @param {object|null} visit - loaded with VISIT_SELECT
 * @param {{ ownStaffId?: string|null, now?: Date }} [options]
 */
export function presentVisit(visit, { ownStaffId = null, now = new Date() } = {}) {
  if (!visit) return null;
  const visible = visit.appointments.filter((a) => !ownStaffId || a.staffId === ownStaffId);
  // A visit reduced to a single prestation (the others cancelled long ago and
  // deleted, or not this reader's) is still shown as one, so the label holds.
  return {
    id: visit.id,
    prestations: visible.map((a) => ({
      id: a.id,
      staffId: a.staffId,
      staffName: a.staffService?.staff?.user?.fullName ?? "—",
      serviceName: a.staffService?.service?.name ?? "Prestation",
      startTime: a.startTime.toISOString(),
      endTime: a.endTime.toISOString(),
      status: a.status,
      price: Number(a.staffService?.price ?? 0),
      amountDue: prestationAmountDue(a),
      // Cashed on another prestation's Payment — see Appointment.coveredByPaymentId.
      coveredByVisit: Boolean(a.coveredByPaymentId),
      completable: a.status === "CONFIRMED" && a.startTime <= now,
    })),
  };
}

/**
 * The prestations a client-side « Terminer toute la visite » would close:
 * everything of the visit that is confirmed and has started.
 */
export function visitCompletablePrestations(visit) {
  return (visit?.prestations ?? []).filter((p) => p.completable);
}

/** The other prestations one Payment settled, for a label or a ticket line. */
export const COVERED_APPOINTMENTS_SELECT = {
  orderBy: { startTime: "asc" },
  select: { staffService: { select: { service: { select: { name: true } } } } },
};

/**
 * « Manucure + Pédicure » — every prestation an appointment Payment settled:
 * its own, then the ones it covers. Reads `coveredAppointments` only when the
 * caller loaded it (COVERED_APPOINTMENTS_SELECT), so an older query that did
 * not still gets the single service name it always had.
 */
export function appointmentPaymentServices(payment) {
  const names = [
    payment?.appointment?.staffService?.service?.name,
    ...(payment?.coveredAppointments ?? []).map((a) => a.staffService?.service?.name),
  ].filter(Boolean);
  return names.length ? names.join(" + ") : null;
}
