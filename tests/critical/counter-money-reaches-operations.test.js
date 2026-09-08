import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * Money taken at the counter has to be findable in Opérations.
 *
 * This is the chain the salon owner actually cares about, and it has two
 * links that are maintained in different files by different people:
 *
 *   1. every counter collection writes a Transaction, and
 *   2. every Transaction is reachable from one of the four Opérations arms.
 *
 * Link 2 is not symmetric, which is the part worth pinning. The ORDER,
 * WORKSHOP and FORMATION arms select from their own tables, so those rows
 * appear whether or not money ever moved. The APPOINTMENT arm selects
 * `FROM "Transaction"` — an appointment with no transaction is invisible.
 * That is deliberate (Opérations is a money ledger, not a lifecycle log), but
 * it means link 1 is load-bearing for appointments in a way it is not for the
 * other three: a collection path that forgot to write a Transaction would
 * take the money and leave no trace on the screen anyone reconciles against.
 *
 * That exact bug existed: completing an appointment booked "payer au salon"
 * wrote a status change and nothing else. Verified against the dev database
 * after the fix — 68 counter collections, 0 unreachable.
 */

const COLLECTORS = [
  ["actions/appointment/manage-appointment.js", "appointment settlement"],
  ["lib/reservations/settle-reservation.js", "atelier / formation settlement"],
  ["actions/boutique/orders.js", "boutique pickup paid at the counter"],
  ["actions/boutique/point-of-sale.js", "till sale"],
];

describe("every counter collection writes a transaction", () => {
  test.each(COLLECTORS)("%s (%s)", (path) => {
    const code = source(path);
    expect(code, `${path} collects money without writing a Transaction`).toContain(
      "tx.transaction.create(",
    );
    // Inside the settling transaction, never after it — a collection recorded
    // outside the commit can be lost while the booking still looks paid.
    expect(code).toContain("prisma.$transaction(");
  });

  test("the walk-in sale reuses the appointment path rather than inventing one", () => {
    // It creates an Appointment and calls completeAppointment, so it inherits
    // the Transaction, the cash-book piece number, the till-session link and
    // the invoice. A parallel implementation here would be a second place to
    // forget one of them.
    const walkIn = source("actions/counter/walk-in-service.js");
    expect(walkIn).toContain("completeAppointment(");
    expect(walkIn, "the walk-in sale writes its own transaction instead of reusing the settlement path")
      .not.toContain("transaction.create(");
  });
});

describe("every source is reachable from Opérations", () => {
  const operations = source("actions/dashboard/admin-operations.js");

  test("the three lifecycle arms select from their own tables", () => {
    // These show up whether or not money moved, so a collection against them
    // is visible as soon as the parent row exists.
    expect(operations).toContain('FROM "Order" o');
    expect(operations).toContain('FROM "workshop_reservations" wr');
    expect(operations).toContain('FROM "formation_reservations" fr');
  });

  test("the appointment arm selects the transaction itself", () => {
    // The asymmetry, stated so nobody 'fixes' it by accident: an appointment
    // reaches Opérations through its money, not through its status. This is
    // why completeAppointment must create a Payment and a Transaction even
    // when the booking never had one.
    expect(operations).toContain('FROM "Transaction" t');
    expect(operations).toContain('JOIN "Appointment" a ON a.id = p."appointmentId"');
    expect(operations).toContain('AND p."appointmentId" IS NOT NULL');
  });

  test("no arm is filtered in a way that hides a completed collection", () => {
    // Each arm's only status filter is the caller's own lifecycleStatus, which
    // defaults to ALL. A hard-coded status predicate inside an arm would drop
    // real money off the screen without anyone noticing.
    expect(operations).toContain('lifecycleStatus !== "ALL"');
    expect(operations).toContain('paymentEvent !== "ALL"');
  });

  test("a settlement revalidates the page it must appear on", () => {
    // Without this the row exists but the screen keeps serving a cached list,
    // which reads to staff as "it didn't show up".
    for (const [path] of COLLECTORS.slice(0, 2)) {
      expect(source(path), path).toContain('revalidatePath("/dashboard/operations")');
    }
  });
});
