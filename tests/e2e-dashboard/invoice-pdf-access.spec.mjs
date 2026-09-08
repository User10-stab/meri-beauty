import { test, expect } from "@playwright/test";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer, customerCredentials } from "../e2e-money/fixtures/seed-money.mjs";
import { seedAdmin, seedStaff, seedAppointmentInvoice, findOrderInvoice } from "./fixtures/seed-dashboard.mjs";

/**
 * Who can download an invoice PDF.
 *
 * This route used to gate on a flat canAccessDashboard, so a staff member
 * granted nothing but "Rendez-vous" could pull any customer's boutique
 * invoice — name, address, VAT number, every line item — by guessing an id.
 * The fix scopes each of the four polymorphic payment sources to the
 * permission that gates its screen, and narrows appointments further to the
 * staff member whose appointment it is.
 *
 * tests/critical/invoice-pdf-access-scope-contracts.test.js greps that route
 * for the checks. It cannot tell whether the server refuses, which is the
 * only thing anyone actually cares about here, and it would keep passing if
 * hasDashboardPermission silently returned true for everyone. So this asks
 * the running server for the actual PDF bytes.
 *
 * Note what is NOT asserted: that a wrong-permission staff member and a
 * nonexistent invoice are indistinguishable. They are not — the route answers
 * 404 before it authorises, so a 403 does confirm an invoice exists. Invoice
 * ids are cuids, so that is a narrow leak rather than an enumeration hole,
 * and pretending otherwise in a test would bake the wrong claim into the
 * suite.
 */

const PDF = /^application\/pdf/;

/** A logged-in browser context. page.request shares its cookie jar. */
async function personaContext(browser, credentials) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, credentials);
  return { context, request: page.request };
}

test.describe("invoice PDF access is scoped to authorised work", () => {
  let appointmentInvoiceId;
  let orderInvoiceId;
  let personas = {};

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);

    // This file's own admin rather than the shared admin@meribeauty.com.
    // Both suites borrowed that one account and shared its 10-per-5-minutes
    // login budget; see T1c in E2E_FINDINGS.md. It is used twice here: as the
    // author of the seeded invoice, and as the persona that proves the
    // refusals below mean something.
    const seededAdmin = await seedAdmin({ label: "invoices" });
    const admin = seededAdmin.user;

    const owner = await seedStaff({ label: "invoice-owner", permissions: ["APPOINTMENTS"] });
    const colleague = await seedStaff({ label: "invoice-colleague", permissions: ["APPOINTMENTS"] });
    const cashier = await seedStaff({ label: "invoice-cashier", permissions: ["ORDERS"] });

    const buyer = await seedCustomer({ label: "invoice-buyer" });
    const stranger = await seedCustomer({ label: "invoice-stranger" });

    const seeded = await seedAppointmentInvoice({
      staff: owner.staff,
      customer: buyer,
      createdByUserId: admin.id,
    });
    appointmentInvoiceId = seeded.invoice.id;
    orderInvoiceId = (await findOrderInvoice()).id;

    personas = {
      owner: await personaContext(browser, owner.credentials),
      colleague: await personaContext(browser, colleague.credentials),
      cashier: await personaContext(browser, cashier.credentials),
      buyer: await personaContext(browser, customerCredentials(buyer)),
      stranger: await personaContext(browser, customerCredentials(stranger)),
      admin: await personaContext(browser, seededAdmin.credentials),
    };
  });

  test.afterAll(async () => {
    for (const persona of Object.values(personas)) await persona.context?.close();
    await disconnect();
  });

  test("an anonymous request is refused before anything is looked up", async ({ request }) => {
    const response = await request.get(`/api/invoices/${appointmentInvoiceId}/pdf`);
    expect(response.status()).toBe(401);
  });

  test("the staff member whose appointment it is gets the PDF", async () => {
    const response = await personas.owner.request.get(`/api/invoices/${appointmentInvoiceId}/pdf`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(PDF);
    // A 200 carrying an HTML error page would otherwise pass the line above
    // on some misconfigurations.
    expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("a colleague with the same permission but a different appointment is refused", async () => {
    // The interesting half of the fix. APPOINTMENTS alone is not enough:
    // "uniquement ses propres rendez-vous" has to hold for the document as
    // well as the screen, or the narrowing is decorative.
    const response = await personas.colleague.request.get(`/api/invoices/${appointmentInvoiceId}/pdf`);
    expect(response.status()).toBe(403);
  });

  test("a cashier cannot read an appointment invoice", async () => {
    const response = await personas.cashier.request.get(`/api/invoices/${appointmentInvoiceId}/pdf`);
    expect(response.status()).toBe(403);
  });

  test("a cashier can read an order invoice, and an appointments-only staff member cannot", async () => {
    const allowed = await personas.cashier.request.get(`/api/invoices/${orderInvoiceId}/pdf`);
    expect(allowed.status()).toBe(200);
    expect(allowed.headers()["content-type"]).toMatch(PDF);

    // The original hole, in the exact shape it had: "Rendez-vous" reaching a
    // boutique invoice.
    const refused = await personas.owner.request.get(`/api/invoices/${orderInvoiceId}/pdf`);
    expect(refused.status()).toBe(403);
  });

  test("the customer who bought it gets it, and another customer does not", async () => {
    const mine = await personas.buyer.request.get(`/api/invoices/${appointmentInvoiceId}/pdf`);
    expect(mine.status()).toBe(200);
    expect(mine.headers()["content-type"]).toMatch(PDF);

    const theirs = await personas.stranger.request.get(`/api/invoices/${appointmentInvoiceId}/pdf`);
    expect(theirs.status()).toBe(403);
  });

  test("an admin reads both, which is what makes the refusals above meaningful", async () => {
    for (const id of [appointmentInvoiceId, orderInvoiceId]) {
      const response = await personas.admin.request.get(`/api/invoices/${id}/pdf`);
      expect(response.status(), `admin was refused invoice ${id}`).toBe(200);
      expect(response.headers()["content-type"]).toMatch(PDF);
    }
  });
});
