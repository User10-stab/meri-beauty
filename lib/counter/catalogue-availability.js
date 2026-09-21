/**
 * Publication status is a *storefront* concern, not a till concern.
 *
 * A brouillon (DRAFT) atelier/formation is one Marie is still writing but
 * already sells in person; an archivé (ARCHIVED) one is retired from the
 * website but may still be run for someone standing at the counter. Both
 * used to be invisible to the counter's omnibar and refused by
 * createCounterReservation, which forced staff to publish a catalogue entry
 * on the public site just to be able to cash it in — then remember to
 * un-publish it.
 *
 * CANCELLED stays out, and it is the whole reason this is an allow-list
 * rather than "anything but archived": a cancelled atelier/formation is an
 * event that is not happening, so a seat on it is not a thing to sell.
 *
 * Same idea for a prestation, which has no status enum: its equivalent of
 * "archived" is `isActive: false`, and the counter queries simply stop
 * filtering on it (see actions/counter/walk-in-service.js). Soft-deleted
 * rows (`isDeleted`) stay excluded everywhere — deleted is deleted.
 */
export const COUNTER_SELLABLE_CATALOGUE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"];

export function isCounterSellableCatalogueStatus(status) {
  return COUNTER_SELLABLE_CATALOGUE_STATUSES.includes(status);
}
