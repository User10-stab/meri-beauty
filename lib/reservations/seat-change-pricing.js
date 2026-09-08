import { repriceTtcCataloguePrice } from "@/lib/tax-policy";

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export const SEAT_CHANGE_ERRORS = Object.freeze({
  INVALID_SEATS: "INVALID_SEATS",
  SAME_SEATS: "SAME_SEATS",
  SEATS_BELOW_CHECKED_IN: "SEATS_BELOW_CHECKED_IN",
  SESSION_FULL: "SESSION_FULL",
  OVERPAYMENT_REQUIRES_MANUAL_HANDLING: "OVERPAYMENT_REQUIRES_MANUAL_HANDLING",
});

/**
 * The arithmetic half of a free counter seat-change, factored out exactly
 * like resolveCounterPriceAdjustment (lib/payments/counter-price-adjustment.js)
 * so it can be unit-tested without a database.
 *
 * Everything that needs a database row (RESERVATION_NOT_CONFIRMED,
 * PAYMENT_NOT_FOUND, PAYMENT_UNDER_REFUND, LEGAL_DOCUMENT_EXISTS,
 * INVOICE_REPLACEMENT_VAT_EXPIRED) stays in change-reservation-seats.js,
 * which calls this in the middle of its own transaction.
 *
 * @param {object} params
 * @param {number} params.catalogueUnitPriceTtc Activity/Formation.price — the
 *   TTC catalogue price, never `totalPrice / currentSeats`.
 * @param {number} params.vatRate From resolveServiceVatPolicy({ customer }).
 * @param {number} params.currentSeats
 * @param {number} params.newSeats
 * @param {number} [params.checkedInSeats]
 * @param {number} [params.discountAmount] Frozen promo/adjustment amount,
 *   carried over unchanged — never re-resolved against the promo code, which
 *   would consume a second redemption.
 * @param {number} [params.paidAmount]
 * @param {number} params.capacity Session capacity.
 * @param {number} [params.occupiedByOthers] Live seat count on the session,
 *   excluding this reservation's own current seats.
 */
export function resolveSeatChange({
  catalogueUnitPriceTtc,
  vatRate,
  currentSeats,
  newSeats,
  checkedInSeats = 0,
  discountAmount = 0,
  paidAmount = 0,
  capacity,
  occupiedByOthers = 0,
}) {
  const newSeatsCount = Number(newSeats);
  if (!Number.isInteger(newSeatsCount) || newSeatsCount < 1) {
    return {
      success: false,
      code: SEAT_CHANGE_ERRORS.INVALID_SEATS,
      message: "Le nombre de places doit être un entier positif.",
    };
  }
  if (newSeatsCount === Number(currentSeats)) {
    return {
      success: false,
      code: SEAT_CHANGE_ERRORS.SAME_SEATS,
      message: "Cette réservation a déjà ce nombre de places.",
    };
  }
  // Deliberately weaker than changeReservationSession's "refuse if any seat
  // is already checked in" — a seat change must still work after a partial
  // arrival, that is the use case at the till. Only going below the number
  // of people already physically admitted is refused.
  if (newSeatsCount < Number(checkedInSeats)) {
    return {
      success: false,
      code: SEAT_CHANGE_ERRORS.SEATS_BELOW_CHECKED_IN,
      message: `${checkedInSeats} place${checkedInSeats > 1 ? "s ont" : " a"} déjà été pointée${checkedInSeats > 1 ? "s" : ""} — impossible de descendre en dessous de ce nombre.`,
    };
  }
  if (Number(occupiedByOthers) + newSeatsCount > Number(capacity)) {
    return {
      success: false,
      code: SEAT_CHANGE_ERRORS.SESSION_FULL,
      message: "Pas assez de places disponibles sur cette séance.",
    };
  }

  // The unit price is always re-derived from the catalogue TTC price at the
  // buyer's own VAT rate — never totalPrice / currentSeats. totalPrice is
  // already post-discount and may already carry a prior counter price
  // adjustment; dividing and re-multiplying it would re-apply the promo on
  // every added seat and launder a previous adjustment into the "unit"
  // price.
  const unitPrice = repriceTtcCataloguePrice(catalogueUnitPriceTtc, vatRate);
  const gross = money(unitPrice * newSeatsCount);
  const frozenDiscount = money(discountAmount);
  const newTotal = money(Math.max(0, gross - frozenDiscount));
  const alreadyPaid = money(paidAmount);

  // Refuse, never clamp: clamping the new total down to what's already paid
  // would leave the customer holding, say, 2 seats at a 4-seat price with no
  // reason and no correcting document.
  if (alreadyPaid > newTotal + 0.01) {
    return {
      success: false,
      code: SEAT_CHANGE_ERRORS.OVERPAYMENT_REQUIRES_MANUAL_HANDLING,
      message: "Le montant déjà encaissé dépasse le nouveau prix — traitez d'abord manuellement le trop-perçu.",
    };
  }

  const newBalance = money(Math.max(0, newTotal - alreadyPaid));
  const newStatus = newBalance <= 0.01 ? "PAID" : alreadyPaid > 0.01 ? "PARTIALLY_PAID" : "PENDING";

  return {
    success: true,
    unitPrice,
    previousSeats: Number(currentSeats),
    newSeats: newSeatsCount,
    newTotal,
    discountAmount: frozenDiscount,
    paidAmount: alreadyPaid,
    newBalance,
    newStatus,
  };
}
