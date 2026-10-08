import { appointmentPaymentServices } from "@/lib/appointments/visit";

/**
 * Ateliers, événements, formations and rendez-vous already receive the
 * legally-required Invoice at cash settlement (see
 * lib/reservations/settle-reservation.js and completeAppointment). No
 * till-style ticket is auto-e-mailed to the client for these flows — the
 * PDF stays available to staff only, via app/api/payments/[id]/ticket.
 */
export function describeReservationPayment(payment) {
  if (payment.appointment) {
    // Several names when the Payment settled a whole visit's prestations.
    const service = appointmentPaymentServices(payment);
    return `Rendez-vous${service ? ` — ${service}` : ""}`;
  }
  if (payment.workshopReservation) {
    const workshop = payment.workshopReservation.session?.workshop;
    const noun = workshop?.type === "EVENT" ? "Événement" : "Atelier";
    return `${noun}${workshop?.title ? ` — ${workshop.title}` : ""}`;
  }
  if (payment.formationReservation) {
    const title = payment.formationReservation.session?.formation?.title;
    return `Formation${title ? ` — ${title}` : ""}`;
  }
  return "Prestation";
}
