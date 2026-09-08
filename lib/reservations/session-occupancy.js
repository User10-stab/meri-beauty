/**
 * "How many seats of this session are actually taken right now."
 *
 * There is no denormalized seatsBooked column on WorkshopSession or
 * FormationSession — occupancy is always summed live from the reservations.
 * That predicate was written out by hand at thirteen call sites across both
 * domains (booking, payment fulfilment, session transfer, the public
 * catalogue, the homepage banner), which is thirteen chances for one of them
 * to drift and start overselling or falsely reporting a session full.
 *
 * Deliberately kept out of any "use server" module: every export of such a
 * file is a public POST endpoint, and this is plain query-building shared by
 * server actions, payment fulfilment and public pages alike.
 *
 * A seat counts as taken when the reservation is CONFIRMED or COMPLETED, or
 * when it is still PENDING_DEPOSIT with a hold that has not lapsed. The
 * 15-minute hold is what stops two people paying for the same last seat; once
 * it expires the seat is free again even though the row is still
 * PENDING_DEPOSIT, which is why an expired hold must NOT be counted.
 */

/**
 * Reservations occupying a seat as of `now`.
 *
 * This is a function rather than a constant on purpose. Written as a
 * module-level object, `new Date()` inside it is evaluated once when the
 * module is first imported and then frozen for the lifetime of the process —
 * so on a long-running server every hold that expired after boot would keep
 * counting as live, and sessions would report themselves full when they are
 * not. Two files shipped that bug (getHomepageBannerData, getPublicFormations)
 * and are fixed by moving to this helper.
 *
 * @param {Date} [now] Evaluation instant; pass the transaction's own clock
 *   when several checks in one transaction must agree with each other.
 */
export function liveSeatFilter(now = new Date()) {
  return {
    OR: [
      { status: { in: ["CONFIRMED", "COMPLETED"] } },
      { status: "PENDING_DEPOSIT", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
    ],
  };
}

/** Uppercase to match RESERVATION_KINDS in ./settle-reservation.js, its neighbour. */
export const OCCUPANCY_KINDS = Object.freeze({
  WORKSHOP: "WORKSHOP",
  FORMATION: "FORMATION",
});

function reservationDelegate(client, kind) {
  if (kind === OCCUPANCY_KINDS.WORKSHOP) return client.workshopReservation;
  if (kind === OCCUPANCY_KINDS.FORMATION) return client.formationReservation;
  throw new Error(`Unknown occupancy kind: ${kind}`);
}

/**
 * Seats taken on one session, as a plain number.
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} client
 *   Pass the transaction client when the answer has to hold for the rest of a
 *   transaction — a capacity check run on `prisma` from inside a transaction
 *   reads outside it and can be stale by the time the row is written.
 * @param {object} params
 * @param {"WORKSHOP"|"FORMATION"} params.kind
 * @param {string} params.sessionId
 * @param {string} [params.excludeReservationId] The reservation being moved or
 *   resized, which must not be counted against the capacity it is asking for.
 * @param {Date} [params.now]
 * @returns {Promise<number>}
 */
export async function sessionOccupancy(client, { kind, sessionId, excludeReservationId, now }) {
  const occupied = await reservationDelegate(client, kind).aggregate({
    where: {
      sessionId,
      ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
      ...liveSeatFilter(now),
    },
    _sum: { seatsCount: true },
  });
  return occupied._sum.seatsCount ?? 0;
}

/**
 * Seats taken for many sessions at once, as a Map keyed by session id.
 *
 * The counter's catalogue search shows "3 places restantes" on every row it
 * lists; doing that with sessionOccupancy would be one query per row.
 *
 * @param {object} params
 * @param {"WORKSHOP"|"FORMATION"} params.kind
 * @param {string[]} params.sessionIds
 * @param {Date} [params.now]
 * @returns {Promise<Map<string, number>>} Sessions with no live reservation are
 *   absent from the map, not zero — read it with `?? 0`.
 */
export async function sessionOccupancyByIds(client, { kind, sessionIds, now }) {
  if (sessionIds.length === 0) return new Map();

  const rows = await reservationDelegate(client, kind).groupBy({
    by: ["sessionId"],
    where: { sessionId: { in: sessionIds }, ...liveSeatFilter(now) },
    _sum: { seatsCount: true },
  });
  return new Map(rows.map((row) => [row.sessionId, row._sum.seatsCount ?? 0]));
}
