import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const allocator = source("lib/tickets/allocate-ticket-number.js");
const activityKindModule = source("lib/activities/activity-kind.js");
const pieceNumberModule = source("lib/cash-book/piece-number.js");
const ticketDocument = source("lib/pdf/TicketDocument.jsx");

describe("lib/tickets/allocate-ticket-number.js — the shared global ticket sequence", () => {
  test("exports the two allocators and the format helper", () => {
    expect(allocator).toContain(
      "export async function allocateOrderTicketNumber(tx, orderId, now = new Date(), isStaffActor = false)"
    );
    expect(allocator).toContain("export async function allocatePaymentTicketNumber(");
    expect(allocator).toContain("export function formatTicketNumber(year, seq, seriesPrefix = \"T\")");
  });

  test("uses its own counter-key namespace, distinct from invoicing and the cash book", () => {
    expect(allocator).toContain("`TICKET-${ticketYear(now)}`");
  });

  test("a non-privileged staff actor gets a separate, still gapless, series", () => {
    expect(allocator).toContain("`TICKET-STAFF-${ticketYear(now)}`");
    expect(allocator).toContain('isStaffActor ? "TS" : "T"');
  });

  test("reuses the same atomic upsert as invoicing/piece-number — no separate retry logic", () => {
    expect(allocator).toContain('INSERT INTO "NumberingCounter"');
    expect(allocator).toContain('ON CONFLICT ("key") DO UPDATE SET "lastNumber" = "NumberingCounter"."lastNumber" + 1');
  });

  test("is idempotent — checks for an existing ticketNumber before allocating", () => {
    expect(allocator).toContain("if (current?.ticketNumber) return current.ticketNumber;");
  });

  test("Workshop vs Event disambiguation goes through the single shared activityKind() helper", () => {
    // Relative, not "@/..." — this module is imported directly by
    // scripts/backfill-ticket-numbers.mjs under plain `node`, which has no
    // "@/" alias resolution (see the module's own import comment).
    expect(allocator).toContain('import { activityKind } from "../activities/activity-kind.js"');
    expect(allocator).toContain('kind === "WORKSHOP" ? activityKind(activityType) : kind');
  });
});

describe("lib/activities/activity-kind.js is the one place Workshop/Event is decided", () => {
  test("piece-number.js and the ticket allocator both import it rather than keeping their own ternary", () => {
    expect(pieceNumberModule).toContain('import { activityKind } from "@/lib/activities/activity-kind"');
    expect(pieceNumberModule).toContain("PIECE_SERIES[activityKind(activityType)]");
    expect(allocator).toContain('import { activityKind } from "../activities/activity-kind.js"');
    expect(activityKindModule).toContain('return activityType === "EVENT" ? "EVENT" : "WORKSHOP";');
  });
});

describe("every hook point that settles a sale allocates a ticket number", () => {
  // Staff-reachable call sites pass a resolved isStaffActor flag (offTill /
  // offTillActor — see isTillCashOperator) so a non-privileged staff sale
  // lands on the separate "TS-" series; the remaining sites have no staff
  // actor at all (customer self-checkout / Stripe webhook) and are
  // deliberately left on the two-argument, admin-series default.
  const cases = [
    ["actions/boutique/point-of-sale.js", "allocateOrderTicketNumber(tx, order.id, new Date(), offTill)"],
    ["lib/orders/fulfill-order-payment.js", "allocateOrderTicketNumber(tx, order.id, new Date(), isStaffActor)"],
    ["actions/boutique/orders.js", "allocateOrderTicketNumber(tx, order.id, new Date(), offTill)"],
    ["lib/workshops/fulfill-workshop-reservation-payment.js", 'allocatePaymentTicketNumber(tx, payment.id, "WORKSHOP"'],
    ["lib/formations/fulfill-formation-reservation-payment.js", 'allocatePaymentTicketNumber(tx, payment.id, "FORMATION")'],
    ["app/api/webhooks/stripe/route.js", 'allocatePaymentTicketNumber(tx, paymentId, "APPOINTMENT")'],
    ["actions/reservation/create-reservation.js", 'allocatePaymentTicketNumber(tx, paymentId, "APPOINTMENT")'],
    ["actions/counter/create-reservation.js", "allocatePaymentTicketNumber("],
    ["lib/reservations/settle-reservation.js", "allocatePaymentTicketNumber(tx, payment.id, kind, activityType, new Date(), offTill)"],
    ["actions/appointment/manage-appointment.js", 'allocatePaymentTicketNumber(tx, updatedPayment.id, "APPOINTMENT", null, new Date(), offTill)'],
  ];

  test.each(cases)("%s calls the shared allocator", (file, expectedSnippet) => {
    expect(source(file)).toContain(expectedSnippet);
  });

  test("actions/counter/create-reservation.js passes offTill for the staff series, whitespace notwithstanding", () => {
    const code = source("actions/counter/create-reservation.js").replace(/\s+/g, " ");
    expect(code).toContain(
      'allocatePaymentTicketNumber( tx, payment.id, data.kind, data.kind === "WORKSHOP" ? catalogue.type : null, new Date(), offTill'
    );
  });

  test("settle-reservation.js allocates on the no-balance-due branch, the balance-due branch, and no-show", () => {
    const code = source("lib/reservations/settle-reservation.js");
    expect(code).toContain("allocatePaymentTicketNumber(tx, payment.id, kind, activityType, new Date(), offTill)");
    expect(code).toContain("allocatePaymentTicketNumber(tx, updatedPayment.id, kind, activityType, new Date(), offTill)");
    expect(code).toContain("allocatePaymentTicketNumber(tx, payment.id, kind, activityType, new Date(), offTillActor)");
  });

  test("manage-appointment.js also tickets a kept no-show deposit, on its own offTillActor", () => {
    const code = source("actions/appointment/manage-appointment.js");
    expect(code).toContain('allocatePaymentTicketNumber(tx, noShowPayment.id, "APPOINTMENT", null, new Date(), offTillActor)');
  });

  test("every staff-reachable site's isStaffActor traces back to isTillCashOperator, not a bare role check", () => {
    for (const file of [
      "actions/boutique/point-of-sale.js",
      "actions/boutique/orders.js",
      "actions/counter/create-reservation.js",
      "lib/reservations/settle-reservation.js",
      "actions/appointment/manage-appointment.js",
    ]) {
      expect(source(file)).toContain("isTillCashOperator");
    }
  });
});

describe("TicketDocument no longer synthesizes an identity at render time", () => {
  test("the T-C-<orderNumber> fallback string is gone", () => {
    expect(ticketDocument).not.toContain("`T-C-${ticket.orderNumber}`");
  });

  test("ticketNumber is read straight off the ticket object", () => {
    expect(ticketDocument).toContain("const ticketNumber = ticket.ticketNumber;");
  });
});
