/**
 * The revenue category a polymorphic Payment belongs to, derived by walking
 * its one populated source relation. Shared by the till's X/Z day report
 * (lib/cash-book/build-day-report.js) and the Livre de recettes
 * (lib/livre-de-recettes/build-recettes-journal.js) so both bucket revenue
 * the exact same way.
 *
 * An atelier and an événement are both WorkshopReservation rows; they are
 * told apart by the parent Activity's `type`, exactly as the booking screens
 * do it.
 *
 * Not a "use server" module — it is pure and unit-tested against plain
 * objects.
 */

export const PAYMENT_CATEGORY_LABELS = {
  ORDER: "Produits",
  APPOINTMENT: "Rendez-vous",
  FORMATION: "Formations",
  WORKSHOP: "Ateliers",
  EVENT: "Événements",
};

/**
 * @param {object|null} payment - a Payment with its source relations included
 *   (`order` / `appointment` / `formationReservation` / `workshopReservation`,
 *   the last with `session.workshop.type`).
 * @returns {"ORDER"|"APPOINTMENT"|"FORMATION"|"WORKSHOP"|"EVENT"|null}
 */
export function categoryForPayment(payment) {
  if (!payment) return null;
  if (payment.order) return "ORDER";
  if (payment.appointment) return "APPOINTMENT";
  if (payment.formationReservation) return "FORMATION";
  if (payment.workshopReservation) {
    return payment.workshopReservation.session?.workshop?.type === "EVENT" ? "EVENT" : "WORKSHOP";
  }
  return null;
}
