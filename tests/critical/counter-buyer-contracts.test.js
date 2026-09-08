import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 8 Sep 2026: completing a buyer's VAT/address at the counter used to only
// exist for a brand-new walk-in customer (point-of-sale.js's own customer
// form). A booking's *existing* buyer — created weeks earlier online, or by
// a different counter flow — had no way to add a VAT number or address once
// the deposit was already taken, so a B2B booking discovered incomplete at
// settlement time failed with BUYER_LEGAL_DATA_INCOMPLETE at the till, with
// the customer already gone (see the unified-counter plan's B2B trap #11).
describe("a booking's buyer can be completed without being reassigned", () => {
  const resolver = source("lib/counter/resolve-counter-customer.js");
  const action = source("actions/counter/update-buyer.js");

  test("resolveCounterCustomer never hand-writes VAT verification fields", () => {
    expect(resolver).toContain('import { saveCheckoutVatNumber } from "@/lib/customer-vat"');
    expect(resolver).toContain("saveCheckoutVatNumber(client, user, input.vatNumber)");
    expect(resolver).not.toContain("vatValidatedAt: new Date()");
    expect(resolver).not.toContain("vatValidationName: viesResult");
  });

  test("a VAT number with no billing address is refused, not silently saved half-complete", () => {
    expect(resolver).toContain("if (user.vatNumber && !user.addressLine1)");
    expect(resolver).toContain("CounterCustomerError");
  });

  test("completing a buyer is gated behind the counter permission, not a booking-specific one", () => {
    expect(action).toContain("hasDashboardPermission(session.user, STAFF_PERMISSIONS.POINT_OF_SALE)");
  });

  test("the action only ever looks up the buyer by id — it cannot be used to swap who they are", () => {
    // No path here writes customerId/userId onto an Appointment, a
    // WorkshopReservation or a FormationReservation — completing a buyer
    // touches only their own User row.
    expect(action).not.toContain("customerId:");
    expect(action).not.toMatch(/appointment\.update|workshopReservation\.update|formationReservation\.update/);
    expect(resolver).toContain('where: { id: input.userId, role: "CUSTOMER", isDeleted: false }');
  });

  test("a request with neither a VAT number nor an address is rejected up front", () => {
    expect(action).toContain("if (!vatNumber && !addressLine1)");
  });
});

// The walk-in service composer used to accept only a bare
// {fullName,email,phone} — a B2B walk-in (no existing account, paying by
// card with a VAT number) had nowhere to enter one. counterCustomerSchema
// already carried the address/VAT fields (added in the extraction that
// created it) specifically so this widening would be additive.
describe("a walk-in service sale can take a B2B buyer, not just a bare B2C one", () => {
  const walkIn = source("actions/counter/walk-in-service.js");

  test("the customer schema is the shared one, not a private ad-hoc shape", () => {
    expect(walkIn).toContain('import { counterCustomerSchema } from "@/lib/validations/counter-customer"');
    expect(walkIn).toContain("counterCustomerSchema.omit({ id: true }).extend({ phone: z.string().trim().min(6) })");
  });

  // 8 Sep 2026: the {userId} branch used to be a bare z.object({userId}) —
  // an already-matched customer could never turn a walk-in appointment sale
  // into a B2B one, because zod's default unknown-key stripping silently
  // dropped any vatNumber/address typed for them before resolveCounterCustomer
  // ever saw it. Merged onto the {userId} branch exactly like
  // create-reservation.js's own buyerSchema already does.
  test("an already-matched customer can still add a VAT number and address to a walk-in sale", () => {
    const start = walkIn.indexOf("const customerSchema = z.union([");
    const block = walkIn.slice(start, start + 500);
    expect(block).toContain("z.object({ userId: z.string().min(1) }).merge(");
    expect(block).toContain("vatNumber: true");
    expect(block).toContain("addressLine1: true");
  });

  test("customer resolution goes through the same resolver a buyer completion uses", () => {
    expect(walkIn).toContain('import { resolveCounterCustomer } from "@/lib/counter/resolve-counter-customer"');
    expect(walkIn).toContain("resolveCounterCustomer(prisma, data.customer)");
  });

  test("a rejected VAT number or missing address surfaces its real message, not a generic failure", () => {
    const create = walkIn.slice(walkIn.indexOf("export async function createCounterWalkInService"));
    expect(create).toContain("if (error instanceof CounterCustomerError)");
    expect(create).toContain("return { success: false, message: error.message };");
  });
});

// The fiche needed the buyer's id and completion status to offer
// FicheBuyerAction at all — lookupActivityCheckIn/lookupActivityCheckInById
// previously only selected fullName/email, enough to display a name but not
// enough to act on the account behind it.
describe("the fiche can identify and complete its own buyer", () => {
  const checkIn = source("actions/activities/check-in.js");
  const fiche = source("components/dashboard/boutique/counter/CounterFiche.jsx");
  const buyerAction = source("components/dashboard/boutique/counter/FicheBuyerAction.jsx");

  test("both appointments and reservations expose the buyer's id and VAT/address completeness", () => {
    expect(checkIn).toContain("holderId: appointment.user.id");
    expect(checkIn).toContain("holderId: reservation.customer.id");
    expect(checkIn).toContain("holderVatInvoiceReady: Boolean(appointment.user.vatValidatedAt)");
    expect(checkIn).toContain("holderVatInvoiceReady: Boolean(reservation.customer.vatValidatedAt)");
    expect(checkIn).toContain("holderHasAddress: Boolean(appointment.user.addressLine1)");
    expect(checkIn).toContain("holderHasAddress: Boolean(reservation.customer.addressLine1)");
  });

  test("the existing holder name/balance contract survives the widened select", () => {
    // Pinned in tests/critical/activity-check-in-contracts.test.js already;
    // re-asserted here because this change touched the same include blocks.
    expect(checkIn).toContain("holderName: reservation.customer.fullName");
    expect(checkIn).toContain("balanceDue: Number(reservation.payment?.remainingAmount ?? reservation.balanceDue)");
  });

  test("the fiche renders the buyer action for every booking, not only a confirmed one", () => {
    expect(fiche).toContain("<FicheBuyerAction ticket={ticket} onChanged={() => onChanged(null)} />");
    // Unlike FicheSettleAction, not gated on ticket.status === "CONFIRMED":
    // a deposit booking (PENDING_DEPOSIT never reaches the fiche as
    // admissible, but CONFIRMED-with-balance-due does) can be missing its
    // address long before settlement.
  });

  test("the action calls the server with the buyer's id, never the reservation's", () => {
    expect(buyerAction).toContain("completeCounterBuyer({");
    expect(buyerAction).toContain("userId: ticket.holderId");
  });
});
