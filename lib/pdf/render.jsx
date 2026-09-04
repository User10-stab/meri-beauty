import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { buildRentalPeriodLabel, shortContractRef } from "@/lib/invoicing";
import { InvoiceDocument, CreditNoteDocument } from "./InvoiceDocument";
import { TicketDocument } from "./TicketDocument";
import { getSellerContact } from "./seller-contact";

/**
 * The "PAYÉE / réglée le …" line comes from the Payment row, which most call
 * sites don't carry on the invoice they pass (issueInvoice returns
 * `include: { lines: true }` only). Resolving it here rather than at each of
 * the six call sites keeps the emailed PDF and the one downloaded later from
 * the dashboard byte-identical — a customer comparing the two should never
 * find one claiming a payment the other doesn't.
 *
 * A failure here degrades to "status not shown", never to a failed render.
 */
async function resolvePayment(invoice) {
  if (invoice.payment?.paidAt) return invoice.payment;
  if (!invoice.paymentId) return null;
  try {
    return await prisma.payment.findUnique({
      where: { id: invoice.paymentId },
      select: { paidAt: true, transactionReference: true },
    });
  } catch {
    return null;
  }
}

/**
 * Rental context for staff contract invoices (reference + period), shown in
 * the existing TermsBlock section. Resolved live from the linked contract —
 * a failure degrades to "rows not shown", never to a failed render.
 */
async function resolveRental(invoice) {
  if (!invoice.contractId) return null;
  try {
    const contract = await prisma.contract.findUnique({
      where: { id: invoice.contractId },
      select: { startDate: true, endDate: true },
    });
    if (!contract?.startDate) return null;
    return {
      reference: shortContractRef(invoice.contractId),
      period: buildRentalPeriodLabel({ startDate: contract.startDate, endDate: contract.endDate ?? null }),
    };
  } catch {
    return null;
  }
}

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
      // The art. 226(8) net twins. Null-guarded rather than blindly
      // Number()-ed: LineItemsTable falls back to dividing the gross for
      // invoices issued before these columns existed, and Number(null) is 0 —
      // which would print a 0,00 € unit price instead of taking that branch.
      unitPriceExclVat: line.unitPriceExclVat == null ? null : Number(line.unitPriceExclVat),
      lineTotalExclVat: line.lineTotalExclVat == null ? null : Number(line.lineTotalExclVat),
    })),
  };
}

export async function renderInvoicePdf(invoice) {
  const [contact, payment, rental] = await Promise.all([
    getSellerContact(),
    resolvePayment(invoice),
    resolveRental(invoice),
  ]);
  return renderToBuffer(
    <InvoiceDocument invoice={{ ...serializeInvoice(invoice), payment }} contact={contact} rental={rental} />
  );
}

export async function renderTicketPdf(ticket) {
  const contact = await getSellerContact();
  return renderToBuffer(
    <TicketDocument
      contact={contact}
      ticket={{
        ...ticket,
        subtotalExclVat: Number(ticket.subtotalExclVat),
        vatRate: Number(ticket.vatRate),
        vatAmount: Number(ticket.vatAmount),
        totalInclVat: Number(ticket.totalInclVat),
      }}
    />
  );
}

export async function renderCreditNotePdf(creditNote, invoice) {
  const contact = await getSellerContact();
  return renderToBuffer(
    <CreditNoteDocument
      contact={contact}
      creditNote={{
        ...creditNote,
        subtotalExclVat: Number(creditNote.subtotalExclVat),
        vatRate: Number(creditNote.vatRate),
        vatAmount: Number(creditNote.vatAmount),
        totalInclVat: Number(creditNote.totalInclVat),
      }}
      invoice={serializeInvoice(invoice)}
    />
  );
}
