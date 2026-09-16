import { roundMoney } from "@/lib/tax-policy";

/**
 * The lines a credit note credits, for its PDF and its Peppol UBL.
 *
 * CreditNote has no line table of its own — only its HT/TVA/TTC amounts —
 * so both documents used to show a bare total with no product or service
 * named. The lines are derived from the invoice being corrected:
 *
 * - a credit of the invoice's whole amount (every cancellation today)
 *   credits every one of its lines, exactly as invoiced;
 * - a partial credit cannot honestly be pinned to particular lines, so it
 *   is one line naming the invoice and what it covered.
 *
 * Every figure is a positive magnitude (like every money column here); the
 * PDF negates at render time. `lineTotalExclVat` always sums to the credit
 * note's own subtotalExclVat, which the UBL builder asserts.
 */

const EPSILON = 0.01;

function netOfGross(gross, vatRate) {
  return Number(gross) / (1 + Number(vatRate) / 100);
}

// Pre-migration InvoiceLine rows store Decimal(0), not null, in the net
// columns — magnitude, not nullishness, decides (same rule as build-ubl.js).
function storedOrNet(stored, gross, vatRate) {
  const value = Number(stored);
  return value > 0 ? value : netOfGross(gross, vatRate);
}

export function isFullCredit(creditNote, invoice) {
  return Math.abs(Number(creditNote.totalInclVat) - Number(invoice.totalInclVat)) <= EPSILON;
}

export function creditNoteLines(creditNote, invoice) {
  const vatRate = Number(creditNote.vatRate ?? invoice.vatRate);
  const lines = invoice?.lines ?? [];

  if (lines.length > 0 && isFullCredit(creditNote, invoice)) {
    return lines.map((line) => {
      const quantity = Number(line.quantity);
      const lineTotal = Number(line.lineTotal ?? Number(line.unitPrice) * quantity);
      return {
        id: line.id,
        description: line.description,
        quantity,
        unitPrice: Number(line.unitPrice),
        lineTotal,
        unitPriceExclVat: storedOrNet(line.unitPriceExclVat, line.unitPrice, vatRate),
        lineTotalExclVat: roundMoney(storedOrNet(line.lineTotalExclVat, lineTotal, vatRate)),
      };
    });
  }

  const covered = lines.map((line) => line.description).filter(Boolean);
  const description =
    `Crédit partiel sur la facture ${invoice.number}` + (covered.length ? ` (${covered.join(", ")})` : "");
  const subtotalExclVat = roundMoney(Number(creditNote.subtotalExclVat));
  return [
    {
      id: "partial",
      description,
      quantity: 1,
      unitPrice: Number(creditNote.totalInclVat),
      lineTotal: Number(creditNote.totalInclVat),
      unitPriceExclVat: subtotalExclVat,
      lineTotalExclVat: subtotalExclVat,
    },
  ];
}
