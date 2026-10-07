/**
 * A visit: the prestations one client booked together from the dashboard
 * (model AppointmentVisit). Each prestation is its own Appointment; these
 * helpers are what lets the screens and the documents treat them as one.
 *
 * Kept out of any "use server" file — plain synchronous helpers and Prisma
 * `select` shapes, shared by the calendar, the appointments list, the
 * completion action and the ticket/cash-book labels.
 */
import { isTillCashOperator } from "@/lib/authorization";

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
        // Whose sale it is — see isIndependentSale below.
        staff: { select: { type: true, user: { select: { email: true, role: true } } } },
        payment: { select: { status: true, paymentType: true, totalAmount: true, paidAmount: true, payeeStaffId: true } },
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
 * An independent practitioner's prestation is her own sale, under her own VAT
 * number — never the salon's. The Payment decides once it exists
 * (Payment.payeeStaffId); before that, the practitioner does. Marie is
 * INDEPENDENT on paper but IS the salon (isTillCashOperator), the same
 * exemption resolvePayeeForStaff applies. Same test as the check-in screen
 * (actions/activities/check-in.js).
 */
function isIndependentSale(appointment) {
  return appointment.payment
    ? Boolean(appointment.payment.payeeStaffId)
    : appointment.staff?.type === "INDEPENDENT" && !isTillCashOperator(appointment.staff.user);
}

/**
 * The visit as the dashboard shows it, or null for an appointment booked on
 * its own.
 *
 * A staff member only ever sees her own prestations of a visit: another
 * practitioner's sale is hers (lib/payments/resolve-payee.js), and its price
 * is not this reader's business.
 *
 * The same holds the other way round. To the salon (an admin, `ownStaffId`
 * null), an independent's prestation of the visit is shown — it is on the
 * client's schedule — but WITHOUT its amounts, and it is never part of what
 * the salon cashes with « Terminer toute la visite ». The salon has no right
 * to read or take an independent's takings; she closes her own prestation
 * from her own dashboard.
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
    prestations: visible.map((a) => {
      // Someone else's sale, as far as this reader is concerned.
      const notTheSalons = !ownStaffId && isIndependentSale(a);
      return {
        id: a.id,
        staffId: a.staffId,
        staffName: a.staffService?.staff?.user?.fullName ?? "—",
        serviceName: a.staffService?.service?.name ?? "Prestation",
        startTime: a.startTime.toISOString(),
        endTime: a.endTime.toISOString(),
        status: a.status,
        independent: notTheSalons,
        price: notTheSalons ? null : Number(a.staffService?.price ?? 0),
        amountDue: notTheSalons ? 0 : prestationAmountDue(a),
        // Cashed on another prestation's Payment — see Appointment.coveredByPaymentId.
        coveredByVisit: Boolean(a.coveredByPaymentId),
        completable: !notTheSalons && a.status === "CONFIRMED" && a.startTime <= now,
      };
    }),
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
