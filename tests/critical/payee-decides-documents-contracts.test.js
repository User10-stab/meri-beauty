import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { issueInvoice } from "../../lib/invoicing.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 17/09/2026 — whose sale it is, not who clicked. An independent's sale
// (Payment.payeeStaffId) is hers: no salon ticket, no salon invoice, no salon
// cash book, even when the admin or Marie settles it. Before this, the
// "independent" test was `!isTillCashOperator(actor)` alone, so the salon
// settling Julie's appointment put the salon's documents on it.
describe("issueInvoice refuses an independent's payment outright", () => {
  const SALON = {
    name: "Meri Beauty",
    vatNumber: "BE0751854027",
    legalName: "Meri Beauty",
    companyRegistrationNo: "0751.854.027",
    addressLine1: "Rue Bonaventure 113",
    addressLine2: null,
    postalCode: "1090",
    city: "Jette",
    countryCode: "BE",
  };
  const B2B = {
    fullName: "Jane Doe",
    email: "jane@example.test",
    address: "Rue Test 1, 1000 Bruxelles",
    isCompany: true,
    vatNumber: "BE0751854027",
    vatValidatedAt: new Date(),
    legalName: "Doe Consulting SRL",
  };

  test("before a number is claimed, so the gapless series never burns one", async () => {
    const tx = {
      $queryRaw: vi.fn(),
      payment: { findUnique: vi.fn().mockResolvedValue({ payeeStaffId: "s_julie" }) },
      salon: { findUnique: vi.fn().mockResolvedValue(SALON) },
      invoice: { create: vi.fn() },
    };
    await expect(
      issueInvoice(tx, {
        paymentId: "pay-julie",
        source: "APPOINTMENT",
        totalInclVat: 121,
        customer: B2B,
        lines: [{ description: "Soin", quantity: 1, unitPrice: 121 }],
      })
    ).rejects.toThrow("INDEPENDENT_SALE_NO_SALON_INVOICE");
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });
});

describe("every settlement path asks the payment who owns it", () => {
  test("settle-reservation: off-till for her sale, including the kept no-show deposit", () => {
    const code = source("lib/reservations/settle-reservation.js");
    expect(code).toContain("const offTill = Boolean(payment.payeeStaffId) || !(await canUseSalonTill(actor));");
    expect(code).toContain("const actorUsesTill = await canUseSalonTill(actor);");
    expect(code).toContain("const offTillActor = !actorUsesTill || Boolean(payment.payeeStaffId);");
  });

  test("completeAppointment: the payment decides, or the practitioner when there is no payment yet", () => {
    const code = source("actions/appointment/manage-appointment.js");
    expect(code).toContain("? Boolean(payment.payeeStaffId)");
    expect(code).toContain(
      ": Boolean((await resolvePayeeForAppointment(prisma, { staffId: appointment.staffId })).payeeStaffId);"
    );
    expect(code).toContain("const offTill = independentSale || !(await canUseSalonTill(authCheck.user));");
    expect(code).toContain("const actorUsesTill = await canUseSalonTill(authCheck.user);");
    expect(code).toContain("const offTillActor = !actorUsesTill || Boolean(noShowPayment.payeeStaffId);");
    expect(code).toContain("!payment.invoice && !payment.payeeStaffId && hasInvoiceableVatIdentity(appointment.user)");
  });

  test("counter seat sale: off-till when the session's animator is independent", () => {
    const code = source("actions/counter/create-reservation.js");
    expect(code).toContain("const offTill = Boolean(payee.payeeStaffId) || !(await canUseSalonTill(guard.session.user));");
    // one payee, resolved once, written on the Payment it decides for
    expect(code.match(/const payee =/g)).toHaveLength(1);
  });

  test("on-site appointment confirmation: no ticket, no till session, no cash-book piece", () => {
    const code = source("actions/reservation/create-reservation.js");
    expect(code).toContain("const independentSale = Boolean(payment.payeeStaffId);");
    expect(code).toContain("const openCashSession = independentSale");
    expect(code).toContain("const pieceNumber = independentSale ? null : await allocatePieceNumber(");
  });

  test("webhook appointment payment: no ticket or invoice for a charge on her account", () => {
    const route = source("app/api/webhooks/stripe/route.js");
    expect(route).toContain("const independentSale = Boolean(existingPayment.payeeStaffId);");
    expect(route).toContain('if (nextPaymentStatus === "PAID" && !independentSale) {');
  });

  test("webhook seat/session change fees never invoice her booking", () => {
    const route = source("app/api/webhooks/stripe/route.js");
    expect(
      route.match(/!reservation\.payment\.invoice && !reservation\.payment\.payeeStaffId && hasInvoiceableVatIdentity/g)
    ).toHaveLength(2);
  });

  test.each([
    "lib/workshops/fulfill-workshop-reservation-payment.js",
    "lib/formations/fulfill-formation-reservation-payment.js",
  ])("%s: no ticket or invoice for a seat she animates", (path) => {
    const code = source(path);
    expect(code).toContain("const independentSale = Boolean(payment.payeeStaffId);");
    expect(code).toContain("if (isFullPayment && !independentSale) {");
    expect(code).toContain("isFullPayment && !independentSale && hasInvoiceableVatIdentity(");
  });

  test.each(["actions/workshops/manage-reservation.js", "actions/formations/manage-reservation.js"])(
    "%s: a forfeited deposit on her booking is not invoiced by the salon",
    (path) => {
      expect(source(path)).toContain("if (!payment.payeeStaffId && hasInvoiceableVatIdentity(reservation.customer)) {");
    }
  );

  test("the client of her sale gets the plain confirmation, never the salon ticket", () => {
    const code = source("lib/payments/send-settlement-email.js");
    expect(code).toContain("salonTicket = !owner?.payeeStaffId && (await canUseSalonTill(actor));");
    expect(code).toContain("if (salonTicket) return emailPaymentTicket(");
  });
});
