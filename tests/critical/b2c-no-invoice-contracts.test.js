import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("B2C sales never issue invoices", () => {
  test("invoice issuance has a central VIES guard before numbering", () => {
    const invoicing = source("lib/invoicing.js");
    const guard = invoicing.indexOf('throw new Error("B2C_INVOICE_NOT_ALLOWED")');
    const numbering = invoicing.indexOf('nextSequenceNumber(tx, "invoice")');

    expect(guard).toBeGreaterThan(-1);
    expect(numbering).toBeGreaterThan(guard);
  });

  test.each([
    ["lib/workshops/fulfill-workshop-reservation-payment.js", "isFullPayment && hasInvoiceableVatIdentity(reservation.customer)"],
    ["lib/formations/fulfill-formation-reservation-payment.js", "isFullPayment && hasInvoiceableVatIdentity(reservation.customer)"],
    ["app/api/webhooks/stripe/route.js", 'nextPaymentStatus === "PAID" && hasInvoiceableVatIdentity(appointment.user)'],
    ["actions/workshops/manage-reservation.js", "hasInvoiceableVatIdentity(reservation.customer)"],
    ["actions/formations/manage-reservation.js", "hasInvoiceableVatIdentity(reservation.customer)"],
  ])("%s checks the validated VAT identity before invoicing", (file, guard) => {
    expect(source(file)).toContain(guard);
  });
});
