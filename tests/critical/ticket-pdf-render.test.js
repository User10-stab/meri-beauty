import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { TicketDocument } from "@/lib/pdf/TicketDocument";

afterEach(() => vi.unstubAllGlobals());

it("renders a multi-collection PDF and a standalone boutique ticket", async () => {
  // Vitest's JSX transform is classic; Next uses the automatic runtime.
  vi.stubGlobal("React", React);
  const ticket = {
    ticketNumber: "T-cm0123456789abcdefghijklmno", invoiceNumber: "F-2026-000065",
    issuedAt: new Date("2026-09-05"), sellerName: "Meri Beauty",
    subtotalExclVat: 50, vatRate: 21, vatAmount: 10.5, totalInclVat: 60.5,
    lines: [{ description: "Acompte formation", quantity: 1, unitPrice: 60.5 }],
  };
  for (const input of [[ticket, { ...ticket, ticketNumber: "T-balance" }], { ...ticket, ticketNumber: undefined, orderNumber: 123 }]) {
    const buffer = await renderToBuffer(React.createElement(TicketDocument, { ticket: input }));
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(1000);
  }
});
