import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// Ateliers/formations/rendez-vous already get a legal Invoice at cash
// settlement, but never the compact till-style ticket a customer expects as
// a receipt — unlike boutique/POS sales, which get one immediately at
// checkout. Rather than threading ticket generation through every
// settlement call site, it is sent once per session, in a single batch,
// right after the till itself closes.
describe("reservation tickets are generated once the cash session closes", () => {
  const actions = source("actions/dashboard/cash-sessions.js");

  test("closeCashSession triggers the batch, after the atomic close claim succeeds", () => {
    const claimIdx = actions.indexOf("if (claim.count === 0)");
    const callIdx = actions.indexOf("sendReservationTicketsForSession(prisma, sessionId)");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(claimIdx);
  });

  test("a PDF/email failure is caught and reported, never left to fail the close response", () => {
    const callIdx = actions.indexOf("sendReservationTicketsForSession(prisma, sessionId)");
    const block = actions.slice(callIdx, callIdx + 200);
    expect(block).toContain(".catch((error)");
    expect(block).toContain("captureError(error,");
  });
});

describe("sendReservationTicketsForSession", () => {
  const lib = source("lib/cash-book/reservation-tickets.js");

  test("only considers CASH final-payment transactions for this exact session", () => {
    expect(lib).toContain('cashSessionId: sessionId');
    expect(lib).toContain('method: "CASH"');
    expect(lib).toContain('transactionType: "FINAL_PAYMENT"');
  });

  test("only fires for a payment that already has an invoice", () => {
    expect(lib).toContain("invoice: { isNot: null }");
  });

  // A boutique/POS sale already received its own ticket immediately at
  // checkout (actions/boutique/point-of-sale.js) — this batch must never
  // send it a second one.
  test("excludes any payment tied to a boutique order — those already got a ticket at checkout", () => {
    expect(lib).toContain("orderId: null");
  });

  test("every send is wrapped so one failure never stops the rest of the batch", () => {
    const forIdx = lib.indexOf("for (const transaction of transactions)");
    expect(forIdx).toBeGreaterThan(-1);
    expect(lib.slice(forIdx)).toContain("} catch (error) {");
  });

  test("describes the reservation by its own kind, same vocabulary as the cash-book ledger", () => {
    expect(lib).toContain('return `Rendez-vous${service ? ` — ${service}` : ""}`;');
    expect(lib).toContain('const noun = workshop?.type === "EVENT" ? "Événement" : "Atelier";');
    expect(lib).toContain('return `Formation${title ? ` — ${title}` : ""}`;');
  });
});

describe("TicketDocument footer adapts when a ticket accompanies an existing invoice", () => {
  const doc = source("lib/pdf/TicketDocument.jsx");

  test("never claims 'not a nominative invoice' when one was already issued", () => {
    const branchIdx = doc.indexOf("ticket.invoiceNumber ?");
    expect(branchIdx).toBeGreaterThan(-1);
    expect(doc.slice(branchIdx, branchIdx + 400)).toContain("accompagne votre facture n°");
  });
});
