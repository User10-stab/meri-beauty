/**
 * Shared error classes thrown by resolveOrCreateCustomer (in
 * actions/reservation/create-reservation.js) and caught by any caller that
 * reuses it — create-reservation.js itself and
 * actions/appointment/create-manual-appointment.js.
 *
 * Kept out of the "use server" action files on purpose: Next.js requires
 * every export of a "use server" module to be an async function, so a
 * `class` export there silently breaks the whole module's exports.
 */

/**
 * Thrown when an authenticated userId no longer matches a live user
 * (expired/deleted session).
 */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "SessionExpiredError";
  }
}

/**
 * Thrown when a P2002 collision on customer creation resolves to a phone
 * number already registered under a different email — see the comment
 * above resolveOrCreateCustomer's P2002 fallback for why this can't be
 * resolved automatically.
 */
export class PhoneAlreadyRegisteredError extends Error {
  constructor() {
    super("Phone already registered to another account");
    this.name = "PhoneAlreadyRegisteredError";
  }
}
