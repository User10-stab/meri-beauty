import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToBuffer } from "@react-pdf/renderer";
import { TicketDocument } from "@/lib/pdf/TicketDocument";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

afterEach(() => vi.unstubAllGlobals());

it("renders a multi-collection PDF and a standalone boutique ticket", async () => {
  // Vitest's JSX transform is classic; Next uses the automatic runtime.
  vi.stubGlobal("React", React);
  const ticket = {
    ticketNumber: "T-cm0123456789abcdefghijklmno", pieceNumber: "R0007", invoiceNumber: "F-2026-000065",
    issuedAt: new Date("2026-09-05"), sellerName: "Meri Beauty",
    subtotalExclVat: 50, vatRate: 21, vatAmount: 10.5, totalInclVat: 60.5,
    lines: [{ description: "Acompte formation", quantity: 1, unitPrice: 60.5 }],
  };
  for (const input of [
    [ticket, { ...ticket, ticketNumber: "T-balance" }],
    { ...ticket, ticketNumber: undefined, orderNumber: 123 },
    // CARD/ONLINE never gets a piece number — the conditional render must
    // not choke on its absence.
    { ...ticket, pieceNumber: null },
  ]) {
    const buffer = await renderToBuffer(React.createElement(TicketDocument, { ticket: input }));
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(1000);
  }
});

// renderToBuffer produces compiled PDF bytes, not greppable text, so the
// actual conditional-render behavior is asserted against the source instead
// — the same pattern used elsewhere in this suite (e.g. bank-deposit-contracts.test.js).
describe("N° pièce only prints when the collection actually had one", () => {
  const template = source("lib/pdf/TicketDocument.jsx");

  it("is conditional on ticket.pieceNumber — a CARD/ONLINE ticket must not print a blank line", () => {
    expect(template).toContain("{ticket.pieceNumber ? <Text style={styles.meta}>N° pièce {ticket.pieceNumber}</Text> : null}");
  });
});
