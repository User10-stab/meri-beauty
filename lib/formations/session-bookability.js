/**
 * When a formation session can still be sold to the public.
 *
 * Until 2026-09-23 only the session status (SCHEDULED) was checked, so a
 * session stayed on sale forever: a date already run, or past its
 * "Inscription avant le …" deadline, could still be booked and paid online —
 * the deadline was only printed, never enforced. A session is open for
 * booking when all three hold:
 *   1. it has not started yet,
 *   2. its registration deadline (if any) has not passed,
 *   3. it has a free seat (paid seats only — see liveSeatFilter).
 * 1 and 2 are "dates"; 3 is capacity and stays with the callers that already
 * count seats, because a full group session is still shown (waiting list).
 *
 * Kept out of any "use server" module: every export of such a file is a
 * public POST endpoint, and this is plain query-building shared by public
 * pages and the booking actions alike.
 */

/** Prisma `where` for sessions whose dates still allow booking (1 and 2). */
export function openSessionDatesWhere(now = new Date()) {
  return {
    status: "SCHEDULED",
    startDate: { gt: now },
    OR: [{ registrationDeadline: null }, { registrationDeadline: { gt: now } }],
  };
}

/**
 * Why a session's dates refuse a booking, or null when they allow it — the
 * same rule as openSessionDatesWhere, for a session row already loaded.
 */
export function sessionDatesRefusal(session, now = new Date()) {
  if (new Date(session.startDate) <= now) {
    return "Cette session a déjà eu lieu ou a déjà commencé.";
  }
  if (session.registrationDeadline && new Date(session.registrationDeadline) <= now) {
    return "Les inscriptions pour cette session sont clôturées.";
  }
  return null;
}
