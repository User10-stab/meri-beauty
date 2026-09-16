import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { parseCustomerOrderReference } from "@/lib/tickets/customer-reference";

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("parseCustomerOrderReference — what a customer reads off their receipt", () => {
  it("resolves a ticket number to a ticketNumber filter, not an order number", () => {
    expect(parseCustomerOrderReference("T-2026-000044")).toEqual({ ticketNumber: "T-2026-000044" });
  });

  it("resolves the separate staff series too — a TS receipt is a real receipt", () => {
    expect(parseCustomerOrderReference("TS-2026-000007")).toEqual({ ticketNumber: "TS-2026-000007" });
  });

  it("pads a sequence typed without its leading zeros", () => {
    // Nobody reads "T-2026-000044" aloud as six digits.
    expect(parseCustomerOrderReference("T-2026-44")).toEqual({ ticketNumber: "T-2026-000044" });
  });

  it("accepts lowercase and stray spaces", () => {
    expect(parseCustomerOrderReference("  t-2026-000044 ")).toEqual({ ticketNumber: "T-2026-000044" });
    expect(parseCustomerOrderReference("T- 2026 - 000044")).toEqual({ ticketNumber: "T-2026-000044" });
  });

  it("still resolves a bare order number, so receipts printed before 15/09/2026 keep working", () => {
    expect(parseCustomerOrderReference("42")).toEqual({ orderNumber: 42 });
  });

  it("returns null for anything unparseable, so the caller answers the generic 'introuvable'", () => {
    for (const input of ["", "   ", "abc", "T-2026", "T-26-000044", "T-2026-0000441", "0", "-3", "3.5", null, undefined]) {
      expect(parseCustomerOrderReference(input)).toBeNull();
    }
  });

  it("never returns both keys — the caller spreads the result straight into a Prisma where", () => {
    for (const input of ["T-2026-000044", "42"]) {
      expect(Object.keys(parseCustomerOrderReference(input))).toHaveLength(1);
    }
  });
});

describe("the receipt shows one reference and one only", () => {
  const ticketDocument = source("lib/pdf/TicketDocument.jsx");

  it("prints the ticket number", () => {
    expect(ticketDocument).toContain("N° ${ticketNumber} — ");
  });

  it("no longer prints the order number next to it — that pairing is what customers read as a contradiction", () => {
    expect(ticketDocument).not.toContain("Commande n° {ticket.orderNumber}");
  });
});

describe("the public return lookup accepts whatever the receipt shows", () => {
  const returns = source("actions/boutique/returns.js");

  it("resolves the customer's reference instead of coercing it to an order number", () => {
    expect(returns).toContain("parseCustomerOrderReference(reference)");
    expect(returns).not.toContain("where: { orderNumber, user:");
  });

  it("hands the resolved filter to Prisma rather than assuming which column it matched", () => {
    expect(returns).toContain("where: { ...orderFilter, user: { email: email.trim().toLowerCase() } }");
  });

  it("still rate-limits per reference, so neither form widens the brute-force budget", () => {
    expect(returns).toContain('recordRateLimitHit("return-lookup-order", rateLimitKey)');
  });

  it("keeps the order number for staff-facing records, which must exist before payment", () => {
    expect(returns).toContain("orderNumber: rr.order.orderNumber");
  });
});
