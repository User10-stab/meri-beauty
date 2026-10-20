import { roundMoney } from "@/lib/tax-policy";
import { buildInvoiceWhere, INVOICE_SOURCE_LABELS } from "@/lib/invoices/list-filters";

/** An export is the whole filtered list at once, so it is bounded. */
export const MAX_INVOICE_EXPORT_ROWS = 5000;

const DELIVERY_LABELS = {
  ALL: "Tous les envois",
  UNSENT: "Jamais envoyées",
  SENT: "Envoyées",
  PEPPOL_PENDING: "Peppol à envoyer",
  CREDITED: "Avec note de crédit",
};
const PAYMENT_LABELS = {
  ALL: "Tous les statuts",
  PAID: "Payé",
  PENDING: "En attente de paiement",
  EN_RETARD: "En retard",
  PARTIALLY_PAID: "Partiellement payé",
  FAILED: "Échoué",
};

const num = (value) => Number(value ?? 0);

function paymentLabel(invoice, now) {
  const status = invoice.payment?.status ?? null;
  if (status === "PAID") return "Payé";
  if (status === "PARTIALLY_PAID") return "Partiel";
  if (status === "FAILED") return "Échoué";
  if (invoice.dueDate && invoice.dueDate < now) return "En retard";
  return status || !invoice.paymentId ? "En attente" : "—";
}

/**
 * The Factures list as one flat, chronological export (oldest first): the
 * same filters as the screen, every page at once. Kept out of the "use
 * server" action so it can be tested against a plain mocked client.
 */
export async function buildInvoicesExport(client, filters) {
  const found = await client.invoice.findMany({
    where: buildInvoiceWhere(filters),
    orderBy: [{ issuedAt: "asc" }, { number: "asc" }],
    take: MAX_INVOICE_EXPORT_ROWS + 1,
    select: {
      number: true,
      source: true,
      paymentId: true,
      issuedAt: true,
      dueDate: true,
      customerName: true,
      customerLegalName: true,
      customerVatNumber: true,
      subtotalExclVat: true,
      vatAmount: true,
      totalInclVat: true,
      emailSentAt: true,
      peppyrusSentAt: true,
      supersededAt: true,
      creditNotes: { select: { totalInclVat: true } },
      payment: { select: { status: true } },
    },
  });

  const truncated = found.length > MAX_INVOICE_EXPORT_ROWS;
  const now = new Date();
  const rows = (truncated ? found.slice(0, MAX_INVOICE_EXPORT_ROWS) : found).map((invoice) => {
    const credited = roundMoney(invoice.creditNotes.reduce((sum, note) => sum + num(note.totalInclVat), 0));
    return {
      number: invoice.number,
      issuedAt: invoice.issuedAt,
      customerName: invoice.customerLegalName || invoice.customerName,
      customerVatNumber: invoice.customerVatNumber ?? null,
      sourceLabel: INVOICE_SOURCE_LABELS[invoice.source] ?? invoice.source,
      amountHt: num(invoice.subtotalExclVat),
      amountVat: num(invoice.vatAmount),
      amountTtc: num(invoice.totalInclVat),
      credited,
      net: roundMoney(num(invoice.totalInclVat) - credited),
      paymentLabel: paymentLabel(invoice, now),
      sentLabel: invoice.emailSentAt && invoice.peppyrusSentAt ? "E-mail + Peppol" : invoice.peppyrusSentAt ? "Peppol" : invoice.emailSentAt ? "E-mail" : "Non envoyée",
      superseded: Boolean(invoice.supersededAt),
    };
  });

  const sum = (key) => roundMoney(rows.reduce((total, row) => total + row[key], 0));
  return {
    filters: {
      from: filters.from || null,
      to: filters.to || null,
      q: filters.q || null,
      sourceLabel: filters.source === "ALL" ? "Toutes origines" : INVOICE_SOURCE_LABELS[filters.source] ?? filters.source,
      deliveryLabel: DELIVERY_LABELS[filters.delivery] ?? filters.delivery,
      paymentLabel: PAYMENT_LABELS[filters.paymentStatus] ?? filters.paymentStatus,
    },
    generatedAt: new Date(),
    truncated,
    rows,
    summary: { count: rows.length, totalHt: sum("amountHt"), totalVat: sum("amountVat"), totalTtc: sum("amountTtc"), credited: sum("credited"), net: sum("net") },
  };
}

/** "du 01/10/2026 au 20/10/2026", or the open-ended / empty variants. */
export function invoicePeriodLabel({ from, to }) {
  const fmt = (ymd) => ymd.split("-").reverse().join("/");
  if (from && to) return `Du ${fmt(from)} au ${fmt(to)}`;
  if (from) return `Depuis le ${fmt(from)}`;
  if (to) return `Jusqu'au ${fmt(to)}`;
  return "Toutes périodes";
}
