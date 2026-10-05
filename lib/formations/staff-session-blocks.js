import { loadStaffBusyIntervals } from "@/lib/formations/custom-date-availability";

/**
 * The formation and atelier sessions a staff member animates, shaped like the
 * appointment rows the rendez-vous availability already reads.
 *
 * Until 2026-10-02 the rendez-vous booking only knew about other rendez-vous
 * and indisponibilités: a client could book Marie at 14:00 on a day she was
 * giving a formation, paid for or not. Every place that loads "this staff
 * member's appointments" to compute free slots now appends these blocks, so
 * a session occupies her exactly as a rendez-vous would.
 *
 * Same rule as everywhere else for a date a client picked herself (« date
 * libre »): it only counts once it is paid.
 *
 * A session running over several days is cut at each midnight (server-local,
 * the convention lib/slot-availability.js works in), because the callers
 * group rows by the calendar day they start on.
 *
 * Kept out of any "use server" module — plain query-building.
 *
 * @param {object} db - Prisma client or transaction client
 * @param {{ staffIds: string[], from: Date, to: Date }} params
 * @returns {Promise<Array<{ isSessionBlock: true, date: Date, startTime: Date, endTime: Date,
 *   staffService: { id: null, staffId: string, margin: number } }>>}
 */
export async function loadStaffSessionBlocks(db, { staffIds, from, to }) {
  const ids = [...new Set((staffIds ?? []).filter(Boolean))];
  if (ids.length === 0) return [];

  const staffRows = await db.staff.findMany({
    where: { id: { in: ids } },
    select: { id: true, userId: true, user: { select: { email: true } } },
  });

  const blocks = [];
  for (const staff of staffRows) {
    const busy = await loadStaffBusyIntervals(db, { staff, from, to });
    for (const interval of busy) {
      if (interval.kind !== "FORMATION" && interval.kind !== "WORKSHOP") continue;
      for (const piece of splitAtMidnights(interval.start, interval.end)) {
        const day = new Date(piece.start);
        day.setHours(0, 0, 0, 0);
        blocks.push({
          isSessionBlock: true,
          date: day,
          startTime: piece.start,
          endTime: piece.end,
          staffService: { id: null, staffId: staff.id, margin: 0 },
        });
      }
    }
  }
  return blocks;
}

function splitAtMidnights(start, end) {
  const pieces = [];
  let cursor = new Date(start);
  while (cursor < end) {
    const nextMidnight = new Date(cursor);
    nextMidnight.setHours(24, 0, 0, 0);
    const pieceEnd = nextMidnight < end ? nextMidnight : new Date(end);
    pieces.push({ start: cursor, end: pieceEnd });
    cursor = pieceEnd;
  }
  return pieces;
}
