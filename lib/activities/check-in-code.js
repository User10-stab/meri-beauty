import { randomBytes } from "crypto";

/**
 * Check-in ("pointage") tickets for rendez-vous, ateliers, événements et
 * formations.
 *
 * Deliberately kept out of any "use server" module — Next.js requires every
 * export of such a file to be an async server action, and most of this is
 * plain synchronous parsing shared by the customer profile and the scanner.
 *
 * A code is minted only when a reservation/appointment reaches CONFIRMED, so
 * holding one is itself evidence that a deposit (or the full price) was
 * actually taken. It is a *bearer* token: a photograph of a valid QR scans
 * exactly like the original, so the scan screen shows the holder's name and
 * the counter staff checks identity. What the QR really guarantees is that
 * the answer comes from the server rather than from a forwarded confirmation
 * e-mail.
 */

export const CHECK_IN_KINDS = Object.freeze({
  WORKSHOP: "workshop",
  FORMATION: "formation",
  APPOINTMENT: "appointment",
});

// Boutique pickup codes (Order.pickupCode) predate this and are a different
// shape entirely — 8 bare hex characters, no letter prefix, a different table
// (Order, not a reservation). PICKUP_KIND lets one counter scanner route to
// either world instead of forcing staff to keep two scanners: see
// parseCheckInCode below.
export const PICKUP_KIND = "pickup";

// One scanner serves every door: the prefix says which table to look in, so
// a formation code scanned at an atelier gives "ce code est une formation"
// instead of a bare "introuvable".
const PREFIXES = Object.freeze({
  [CHECK_IN_KINDS.WORKSHOP]: "A",
  [CHECK_IN_KINDS.FORMATION]: "F",
  [CHECK_IN_KINDS.APPOINTMENT]: "R",
});

const KIND_BY_PREFIX = Object.freeze(
  Object.fromEntries(Object.entries(PREFIXES).map(([kind, prefix]) => [prefix, kind]))
);

// 5 bytes = 40 bits. Guessing is not the primary threat (every lookup is
// behind a staff permission), but a ticket is longer-lived than a boutique
// pickup code and gets a wider margin than the 4 bytes used there.
const CODE_BYTES = 5;

const CODE_PATTERN = /^([AFR])-([0-9A-F]{10})$/;

// A pickup code is exactly 8 hex characters with no hyphen — always shorter
// than a ticket (11 characters without its hyphen), so there is no overlap
// between the two shapes to disambiguate.
const PICKUP_PATTERN = /^[0-9A-F]{8}$/;

/** @param {"workshop"|"formation"|"appointment"} kind */
export function generateCheckInCode(kind) {
  const prefix = PREFIXES[kind];
  if (!prefix) throw new Error(`Unknown check-in kind: ${kind}`);
  return `${prefix}-${randomBytes(CODE_BYTES).toString("hex").toUpperCase()}`;
}

/**
 * Normalises whatever the camera or the keyboard produced, and says which
 * table it addresses — including a bare boutique pickup code, which is
 * "pickup" rather than one of CHECK_IN_KINDS since it lives on Order, not a
 * reservation.
 *
 * @param {string} raw
 * @returns {{ kind: "workshop"|"formation"|"appointment"|"pickup", code: string } | null}
 */
export function parseCheckInCode(raw) {
  if (typeof raw !== "string") return null;
  // A USB barcode wedge appends a newline; a phone camera can pick up
  // surrounding whitespace. Tolerate a missing hyphen too — it is the one
  // character a human retyping the fallback code reliably drops.
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!cleaned) return null;

  if (PICKUP_PATTERN.test(cleaned)) {
    return { kind: PICKUP_KIND, code: cleaned };
  }

  const withHyphen = cleaned.includes("-") ? cleaned : cleaned.replace(/^([AFR])/, "$1-");

  const match = CODE_PATTERN.exec(withHyphen);
  if (!match) return null;

  return { kind: KIND_BY_PREFIX[match[1]], code: withHyphen };
}

/** Prisma delegate + relation shape for a kind, so callers stay symmetrical. */
export function checkInDelegate(client, kind) {
  if (kind === CHECK_IN_KINDS.WORKSHOP) return client.workshopReservation;
  if (kind === CHECK_IN_KINDS.FORMATION) return client.formationReservation;
  if (kind === CHECK_IN_KINDS.APPOINTMENT) return client.appointment;
  throw new Error(`Unknown check-in kind: ${kind}`);
}

/**
 * Returns the reservation's check-in code, minting one if it has none.
 *
 * Reservations confirmed before this feature shipped have no code, and the
 * migration deliberately did not backfill them (a bulk INSERT of random
 * values against a fresh unique index can collide and fail the deploy). They
 * get one here instead, on first read.
 *
 * The write is conditional on `checkInCode: null`, so two concurrent readers
 * — the customer opening their profile while staff scans the printed
 * fallback — cannot mint two codes for one reservation: the loser's WHERE
 * matches zero rows and it re-reads the winner's value.
 *
 * @returns {Promise<string|null>} null if the reservation vanished meanwhile
 */
export async function ensureCheckInCode(client, kind, reservationId) {
  const delegate = checkInDelegate(client, kind);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await delegate.findUnique({
      where: { id: reservationId },
      select: { checkInCode: true, status: true },
    });
    if (!current) return null;
    // All three models share CONFIRMED. Keeping this invariant here means a
    // future caller cannot accidentally mint a live-looking ticket for a
    // pending, cancelled or completed booking merely by knowing its id.
    if (current.status !== "CONFIRMED") return null;
    if (current.checkInCode) return current.checkInCode;

    const code = generateCheckInCode(kind);
    try {
      const claim = await delegate.updateMany({
        where: { id: reservationId, status: "CONFIRMED", checkInCode: null },
        data: { checkInCode: code },
      });
      if (claim.count === 1) return code;
      // Lost the race — loop re-reads and returns the winner's code.
    } catch (error) {
      // P2002: the random value collided with another reservation's code.
      // Retry with a fresh one; anything else is not ours to swallow.
      if (error?.code !== "P2002") throw error;
    }
  }

  throw new Error("CHECK_IN_CODE_EXHAUSTED");
}
