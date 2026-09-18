/**
 * The one global, gapless, Brussels-year-reset ticket sequence — every sale
 * type shares it (see prisma/schema.prisma's TicketKind), so "T-2026-000047"
 * on a boutique receipt and "T-2026-000048" on a rendez-vous receipt is
 * expected, not a bug: a single-domain view (e.g. "all boutique tickets")
 * will show gaps wherever a different-domain sale landed in between. Same
 * atomic INSERT..ON CONFLICT..RETURNING as lib/invoicing.js#nextSequenceNumber
 * and lib/cash-book/piece-number.js#allocatePieceNumber — own counter
 * namespace ("TICKET-<year>") so it can never collide with
 * "invoice-<year>"/"creditnote-<year>"/"CAISSE-<series>-<year>". MUST be
 * called with the caller's own open `tx`, inside the same transaction that
 * settles the sale, so a rolled-back sale never burns a number.
 *
 * A non-privileged staff actor (isStaffActor — see
 * lib/authorization.js#isTillCashOperator, which is what every caller uses
 * to decide it) now gets NO number at all: every practitioner here is
 * legally independent, so her sale is hers to document under her own VAT
 * number and the salon issues nothing. The same holds for a Payment owned by
 * an independent (Payment.payeeStaffId), whoever settles it. The old
 * "TS-<year>-<seq>" staff series is gone: it never issued a single
 * production ticket. isTillCashOperator is deliberately NOT imported here: this
 * module stays free of "@/" alias imports so scripts/backfill-ticket-numbers.mjs
 * can import it directly — callers resolve the actor and pass a plain boolean
 * instead. Dropping the alias is necessary but not sufficient: this file is a
 * `.js` under a package.json with no "type", so Node treats it as CommonJS and
 * only >= 22.7 detects the ESM syntax. The backfill therefore runs through
 * `npm run backfill:tickets`, which adds --experimental-detect-module — see
 * that script's header. Bare `node scripts/...` fails on production's Node 20.
 * Omitting the flag (the backfill script, and every flow with no staff actor
 * at all, such as a customer's own online checkout) means "allocate".
 */

// Relative, not "@/..." — scripts/backfill-ticket-numbers.mjs imports this
// module directly under plain `node`, which has no "@/" alias resolution
// (only Next.js/webpack and Vitest do). Same reasoning as lib/refunds/plan-refund.js.
import { activityKind } from "../activities/activity-kind.js";

export const TICKET_KINDS = Object.freeze({
  ORDER: "ORDER",
  APPOINTMENT: "APPOINTMENT",
  WORKSHOP: "WORKSHOP",
  EVENT: "EVENT",
  FORMATION: "FORMATION",
});

const TICKET_DIGITS = 6;

export function ticketYear(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Brussels", year: "numeric" }).format(now));
}

export function formatTicketNumber(year, seq) {
  return `T-${year}-${String(seq).padStart(TICKET_DIGITS, "0")}`;
}

async function claimNextTicketNumber(tx, now) {
  const key = `TICKET-${ticketYear(now)}`;
  const rows = await tx.$queryRaw`
    INSERT INTO "NumberingCounter" ("key", "lastNumber") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "lastNumber" = "NumberingCounter"."lastNumber" + 1
    RETURNING "lastNumber"
  `;
  return formatTicketNumber(ticketYear(now), Number(rows[0].lastNumber));
}

/**
 * Idempotent: a second call for an Order that already has a ticketNumber is
 * a no-op returning the existing value, never a second allocation — this is
 * what lets every "this order is now paid" commit path call it unconditionally
 * without separately tracking whether it already ran.
 *
 * @param {boolean} [isStaffActor] True only for a non-privileged STAFF actor
 *   (see isTillCashOperator). Such a sale belongs to the independent who
 *   made it, not to the salon, so no number is allocated at all and this
 *   returns null — every caller must tolerate that.
 * @returns {Promise<string|null>}
 */
export async function allocateOrderTicketNumber(tx, orderId, now = new Date(), isStaffActor = false) {
  // Chez Meri Beauty every practitioner is legally independent, invoicing
  // under her own VAT number: a sale she collects is hers, so the salon
  // issues no ticket for it. `isStaffActor` is always
  // `!isTillCashOperator(actor)`, so the ADMIN account and Marie Mercier
  // (whose VAT number IS the salon's, despite her STAFF role) arrive here
  // with `false` and are ticketed as the salon.
  if (isStaffActor) return null;
  const current = await tx.order.findUnique({ where: { id: orderId }, select: { ticketNumber: true } });
  if (current?.ticketNumber) return current.ticketNumber;
  const ticketNumber = await claimNextTicketNumber(tx, now);
  await tx.order.update({ where: { id: orderId }, data: { ticketNumber, ticketKind: TICKET_KINDS.ORDER } });
  return ticketNumber;
}

/**
 * Same idempotency guarantee, for the three reservation/appointment Payment
 * kinds. This is what makes a multi-leg settlement safe: an acompte taken
 * online today allocates nothing; the solde collected weeks later at the
 * counter is the call that actually finds ticketNumber still null and
 * allocates — whichever leg happens to be the one that finishes the sale,
 * exactly once.
 *
 * @param {"APPOINTMENT"|"WORKSHOP"|"FORMATION"} kind
 * @param {"WORKSHOP"|"EVENT"|null} [activityType] Required, and only
 *   meaningful, when kind === "WORKSHOP" — see lib/activities/activity-kind.js.
 * @param {boolean} [isStaffActor] See allocateOrderTicketNumber's own doc —
 *   in particular, a true value allocates nothing and returns null. A Payment
 *   owned by an independent (payeeStaffId) also gets null, whatever the flag.
 * @returns {Promise<string|null>}
 */
export async function allocatePaymentTicketNumber(
  tx,
  paymentId,
  kind,
  activityType = null,
  now = new Date(),
  isStaffActor = false
) {
  // Chez Meri Beauty every practitioner is legally independent, invoicing
  // under her own VAT number: a sale she collects is hers, so the salon
  // issues no ticket for it. `isStaffActor` is always
  // `!isTillCashOperator(actor)`, so the ADMIN account and Marie Mercier
  // (whose VAT number IS the salon's, despite her STAFF role) arrive here
  // with `false` and are ticketed as the salon.
  if (isStaffActor) return null;
  const current = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { ticketNumber: true, payeeStaffId: true },
  });
  // Whose sale it is, not who clicked: an independent practitioner's payment
  // (Payment.payeeStaffId, see lib/payments/resolve-payee.js) is hers, and the
  // salon issues no ticket for it — even when the admin or Marie settles it.
  if (current?.payeeStaffId) return null;
  if (current?.ticketNumber) return current.ticketNumber;
  const resolvedKind = kind === "WORKSHOP" ? activityKind(activityType) : kind;
  const ticketNumber = await claimNextTicketNumber(tx, now);
  await tx.payment.update({ where: { id: paymentId }, data: { ticketNumber, ticketKind: resolvedKind } });
  return ticketNumber;
}
