import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// Ateliers/formations/rendez-vous get their legal Invoice at cash
// settlement (issued inside the settlement transaction), but no till-style
// ticket is ever auto-e-mailed to the client — neither inline at settlement
// nor batched once the cash session closes. The ticket PDF stays available
// to staff only, for reprint (app/api/payments/[id]/ticket).
describe("closing a cash session never e-mails a reservation ticket to the client", () => {
  const actions = source("actions/dashboard/cash-sessions.js");
  const lib = source("lib/cash-book/reservation-tickets.js");

  test("closeCashSession no longer calls the (removed) batch sender", () => {
    expect(actions).not.toContain("sendReservationTicketsForSession");
  });

  test("sendReservationTicketsForSession no longer exists — describeReservationPayment remains for the staff reprint route", () => {
    expect(lib).not.toContain("export async function sendReservationTicketsForSession");
    expect(lib).not.toContain("sendEmail(");
    expect(lib).toContain("export function describeReservationPayment(");
  });
});

describe("TicketDocument footer adapts when a ticket accompanies an existing invoice", () => {
  const doc = source("lib/pdf/TicketDocument.jsx");

  test("never claims 'not a nominative invoice' when one was already issued", () => {
    const branchIdx = doc.indexOf("ticket.invoiceNumber ?");
    expect(branchIdx).toBeGreaterThan(-1);
    expect(doc.slice(branchIdx, branchIdx + 400)).toContain("Facture liée :");
    expect(doc.slice(branchIdx, branchIdx + 400)).toContain("Ce ticket ne remplace pas la facture");
  });
});
