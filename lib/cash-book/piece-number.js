/**
 * Piece numbers for the cash book ("livre de caisse").
 *
 * A cash book is read as a continuous ledger, and a *gap* in its piece
 * numbers is precisely what a controller asks about. That is what rules out
 * reusing Order.orderNumber as a sale's piece number, tempting as it is —
 * it is already the ticket number the customer walks out with, so one
 * identifier would cover everything. But ONLINE and POS orders share a
 * single autoincrement (see enum OrderSource), so a till-only series derived
 * from it reads V0034, V0087, V0091: every web order placed between two
 * counter sales shows up in the book as a hole that has to be explained.
 *
 * So the book keeps its own contiguous series, and the ticket/order/invoice
 * number travels beside it in a "Réf." column — one line, two references,
 * neither pretending to be the other.
 *
 * The other three sale sources have no human-readable number at all
 * (WorkshopReservation, FormationReservation and Appointment carry only a
 * cuid and a checkInCode), so there was never a single existing identifier
 * that could have covered the whole book anyway.
 */

/**
 * One letter per kind of line. Sales are keyed by which of Payment's four
 * source relations is set; ateliers and events split on Activity.type, which
 * is the only thing distinguishing them (they share WorkshopReservation).
 *
 * Aligned deliberately with the check-in QR prefixes in
 * lib/activities/check-in-code.js (PREFIXES: workshop->A, formation->F,
 * appointment->R) — a rendez-vous already reads "R-3F8A2B" on the printed
 * ticket staff hand out every day, and the cash book would be actively
 * confusing if the same booking showed up as "P0007" in the ledger instead.
 * EVENT has no check-in prefix of its own (it currently shares "A" with
 * WORKSHOP there) but gets a distinct letter here — separating event revenue
 * from workshop revenue is the cash book's job, not the scanner's.
 */
export const PIECE_SERIES = Object.freeze({
  ORDER: "V", // vente de produits
  APPOINTMENT: "R", // rendez-vous — matches CHECK_IN_KINDS.APPOINTMENT's "R" prefix
  FORMATION: "F", // formation — matches CHECK_IN_KINDS.FORMATION's "F" prefix
  WORKSHOP: "A", // atelier — matches CHECK_IN_KINDS.WORKSHOP's "A" prefix, Activity.type === "WORKSHOP"
  EVENT: "E", // événement — Activity.type === "EVENT", no check-in prefix of its own
  EXPENSE: "D", // sortie d'espèces (dépense)
  MOVEMENT: "X", // apport / prélèvement
});

const VALID_SERIES = new Set(Object.values(PIECE_SERIES));

/** "V" + 1 -> "V0001". Four digits: a single till will not pass 9999 lines of one series in a year, and it stays sortable as text. */
export function formatPieceNumber(series, seq) {
  if (!VALID_SERIES.has(series)) throw new Error(`Unknown cash-book series: ${series}`);
  return `${series}${String(seq).padStart(4, "0")}`;
}

/** The series letter a non-sale drawer movement belongs to. */
export function seriesForMovementType(type) {
  return type === "EXPENSE" ? PIECE_SERIES.EXPENSE : PIECE_SERIES.MOVEMENT;
}

/**
 * Ateliers et événements share one reservation flow (WorkshopReservation)
 * and are only ever told apart by Activity.type — settleReservation's
 * WORKSHOP kind covers both, so the caller must join to the workshop's type
 * and pass it here rather than assuming every such reservation is an
 * atelier.
 */
export function seriesForActivityType(activityType) {
  return activityType === "EVENT" ? PIECE_SERIES.EVENT : PIECE_SERIES.WORKSHOP;
}

/**
 * The Brussels calendar year, not the process-local one. Same reasoning as
 * invoice numbering: deploy hosts, CI and cron workers all run on UTC, so a
 * line recorded at 00:30 Brussels on 1 January would otherwise be numbered
 * into the year that just ended and collide with a number already issued.
 */
export function cashBookYear(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Brussels", year: "numeric" }).format(now));
}

export function counterKey(series, year) {
  return `CAISSE-${series}-${year}`;
}

/**
 * Claims the next number in a series, atomically.
 *
 * The INSERT ... ON CONFLICT DO UPDATE is a single statement, so two
 * concurrent callers are serialized by the row lock rather than by a
 * read-then-write that both sides could win — the same mechanism invoice
 * numbering uses. MUST be called with `tx` inside the transaction that
 * writes the line, so a rolled-back line does not burn a number and leave
 * the gap this whole module exists to avoid.
 */
export async function allocatePieceNumber(tx, series, now = new Date()) {
  if (!VALID_SERIES.has(series)) throw new Error(`Unknown cash-book series: ${series}`);
  const key = counterKey(series, cashBookYear(now));
  const rows = await tx.$queryRaw`
    INSERT INTO "NumberingCounter" ("key", "lastNumber") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "lastNumber" = "NumberingCounter"."lastNumber" + 1
    RETURNING "lastNumber"
  `;
  return formatPieceNumber(series, Number(rows[0].lastNumber));
}
