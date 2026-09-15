/**
 * Ateliers et événements share one reservation flow (WorkshopReservation)
 * and are only ever told apart by Activity.type. This is the single place
 * that decision is made — lib/cash-book/piece-number.js#seriesForActivityType
 * and lib/tickets/allocate-ticket-number.js both call this rather than
 * keeping their own copy of the same ternary, so they can never quietly
 * disagree about which reservation is which.
 */
export function activityKind(activityType) {
  return activityType === "EVENT" ? "EVENT" : "WORKSHOP";
}
