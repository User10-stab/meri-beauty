import { renderToBuffer } from "@react-pdf/renderer";
import { InvoiceDocument, CreditNoteDocument } from "./InvoiceDocument";

/** Prisma Decimal fields never cross into a render tree unconverted. */
function serializeInvoice(invoice) {
  return {
    ...invoice,
    subtotalExclVat: Number(invoice.subtotalExclVat),
    vatRate: Number(invoice.vatRate),
    vatAmount: Number(invoice.vatAmount),
    totalInclVat: Number(invoice.totalInclVat),
    lines: invoice.lines.map((line) => ({
      ...line,
      unitPrice: Number(line.unitPrice),
      lineTotal: Number(line.lineTotal),
    })),
  };
}

export async function renderInvoicePdf(invoice) {
  return renderToBuffer(<InvoiceDocument invoice={serializeInvoice(invoice)} />);
}

export async function renderCreditNotePdf(creditNote, invoice) {
  return renderToBuffer(
    <CreditNoteDocument
      creditNote={{ ...creditNote, totalInclVat: Number(creditNote.totalInclVat) }}
      invoice={serializeInvoice(invoice)}
    />
  );
}
