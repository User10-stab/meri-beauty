/**
 * Resolves whatever a customer reads off their receipt into a Prisma filter.
 *
 * Since 15/09/2026 a receipt shows one reference only: its ticket number
 * (T-2026-000044, or TS-… when a non-privileged staff member rang the sale
 * up — see lib/tickets/allocate-ticket-number.js). Every receipt printed
 * before that date shows an order number instead, and those stay in
 * circulation well past the 14-day withdrawal window, so both must resolve.
 * That is the whole reason this returns a filter rather than one parsed
 * integer.
 *
 * Returns null for anything unparseable; callers must answer with the same
 * generic "introuvable" they use for a wrong email, since the return lookup
 * is public and unauthenticated.
 */

const TICKET_REFERENCE = /^(TS?)-(\d{4})-(\d{1,6})$/;

export function parseCustomerOrderReference(raw) {
  const value = String(raw ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!value) return null;

  const ticket = TICKET_REFERENCE.exec(value);
  if (ticket) {
    const [, series, year, sequence] = ticket;
    // Padded because a customer reading "T-2026-000044" aloud types "T-2026-44".
    return { ticketNumber: `${series}-${year}-${sequence.padStart(6, "0")}` };
  }

  if (/^\d+$/.test(value)) {
    const orderNumber = Number(value);
    if (Number.isSafeInteger(orderNumber) && orderNumber > 0) return { orderNumber };
  }

  return null;
}
