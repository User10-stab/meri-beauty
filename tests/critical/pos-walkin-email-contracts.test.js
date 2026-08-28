import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pointOfSaleSaleSchema } from "@/lib/validations/point-of-sale";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

const baseSale = {
  customer: null,
  items: [{ type: "PRODUCT", variantId: "v1", quantity: 1 }],
  method: "CASH",
  attemptKey: "a".repeat(20),
  cashReceived: 10,
};

describe("the walk-in ticket e-mail is optional and format-checked", () => {
  test("no e-mail at all is accepted — most walk-ins take only a printed ticket", () => {
    const result = pointOfSaleSaleSchema.safeParse(baseSale);
    expect(result.success).toBe(true);
    expect(result.data.walkInEmail).toBe("");
  });

  test("a blank string is accepted the same way", () => {
    const result = pointOfSaleSaleSchema.safeParse({ ...baseSale, walkInEmail: "" });
    expect(result.success).toBe(true);
    expect(result.data.walkInEmail).toBe("");
  });

  test("a well-formed e-mail is normalised and kept", () => {
    const result = pointOfSaleSaleSchema.safeParse({ ...baseSale, walkInEmail: "  Client@Example.com " });
    expect(result.success).toBe(true);
    expect(result.data.walkInEmail).toBe("client@example.com");
  });

  test("a malformed e-mail fails validation rather than being silently dropped", () => {
    const result = pointOfSaleSaleSchema.safeParse({ ...baseSale, walkInEmail: "not-an-email" });
    expect(result.success).toBe(false);
  });

  test("a disposable-domain e-mail is rejected, same rule as every other e-mail field", () => {
    const result = pointOfSaleSaleSchema.safeParse({ ...baseSale, walkInEmail: "someone@mailinator.com" });
    expect(result.success).toBe(false);
  });
});

describe("completePointOfSaleSale wires the walk-in e-mail without creating an invoice", () => {
  const posSource = source("actions/boutique/point-of-sale.js");

  test("the ticket, not an Invoice, is what gets attached and sent", () => {
    const walkInBlockStart = posSource.indexOf("if (isWalkIn) {");
    const emailCallIndex = posSource.indexOf("sendEmail(ticketEmail)");
    const attachmentIndex = posSource.indexOf("filename: `ticket-${result.order.orderNumber}.pdf`");
    expect(walkInBlockStart).toBeGreaterThan(-1);
    expect(emailCallIndex).toBeGreaterThan(walkInBlockStart);
    expect(attachmentIndex).toBeGreaterThan(walkInBlockStart);
    // Never routes through issueInvoice for a walk-in — no name means no
    // legal nominative invoice, only ever the anonymous ticket.
    const walkInBlockEnd = posSource.indexOf("\n    }\n", walkInBlockStart);
    expect(posSource.slice(walkInBlockStart, walkInBlockEnd)).not.toContain("issueInvoice(");
  });

  test("a failed send is reported but never fails the already-completed sale", () => {
    expect(posSource).toContain("ticketEmailSent = Boolean(ticketEmailResult?.success)");
    expect(posSource).toContain("ticketEmailSent");
    // The walk-in success branch returns success:true regardless of email
    // outcome — searched within the same block used above.
    const walkInBlockStart = posSource.indexOf("if (isWalkIn) {");
    const successIndex = posSource.indexOf("success: true,", walkInBlockStart);
    expect(successIndex).toBeGreaterThan(walkInBlockStart);
  });

  test("the field only applies to a walk-in — a named customer's own invoice e-mail is unaffected", () => {
    expect(posSource).toContain("walkInEmail && ticketPdf");
  });
});

describe("the POS UI warns before e-mailing a walk-in ticket to an existing account", () => {
  const clientSource = source("components/dashboard/boutique/PointOfSaleClient.jsx");

  test("checks for an exact e-mail match rather than a loose substring search", () => {
    expect(clientSource).toContain("searchPointOfSaleCustomers(value)");
    // Exact match required — a "contains" search alone would also flag an
    // unrelated account whose email merely contains the typed string.
    expect(clientSource).toContain("match.email.toLowerCase() === value.toLowerCase()");
  });

  test("offers a one-click switch onto the real account instead of sending it anonymously", () => {
    expect(clientSource).toContain("function useMatchedAccountInstead()");
    expect(clientSource).toContain("toggleWalkIn(false)");
    expect(clientSource).toContain("selectCustomer(walkInEmailMatch)");
    expect(clientSource).toContain("Un compte existe déjà pour cette adresse");
  });

  test("the warning only triggers once the typed address looks like a complete e-mail", () => {
    // Guards against firing a lookup on every keystroke of a half-typed address.
    expect(clientSource).toMatch(/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$/);
  });
});

describe("a walk-in ticket e-mail attempt is recorded, not just toasted once", () => {
  const posSource = source("actions/boutique/point-of-sale.js");
  const schema = source("prisma/schema.prisma");
  const orderDetailSource = source("components/dashboard/boutique/OrderDetailClient.jsx");

  test("the outcome is persisted on the order, success or failure", () => {
    // A non-null posTicketEmailTo with a null posTicketEmailSentAt IS the
    // record of a failed send — this is the only after-the-fact way to
    // answer "did the customer's ticket actually go out?" once the
    // cashier's one-shot toast and any console output are gone.
    expect(schema).toContain("posTicketEmailTo     String?");
    expect(schema).toContain("posTicketEmailSentAt DateTime?");
    expect(posSource).toContain("posTicketEmailTo: walkInEmail, posTicketEmailSentAt: ticketEmailSent ? new Date() : null");
    // Written after computing ticketEmailSent — never before, or a failure
    // would misrecord as if it succeeded.
    const computedAt = posSource.indexOf("ticketEmailSent = Boolean(ticketEmailResult?.success)");
    const persistedAt = posSource.indexOf("posTicketEmailTo: walkInEmail");
    expect(persistedAt).toBeGreaterThan(computedAt);
  });

  test("a tracking-write failure cannot turn an already-paid sale into an error response", () => {
    const persistedAt = posSource.indexOf("posTicketEmailTo: walkInEmail");
    const surroundingBlock = posSource.slice(persistedAt - 200, persistedAt + 300);
    expect(surroundingBlock).toContain(".catch(");
  });

  test("the dashboard order page surfaces sent / failed / not-requested for a walk-in", () => {
    expect(orderDetailSource).toContain("order.posTicketEmailTo");
    expect(orderDetailSource).toContain("order.posTicketEmailSentAt");
    expect(orderDetailSource).toContain("Client de passage");
  });
});
