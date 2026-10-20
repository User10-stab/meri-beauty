import { invoicePeriodLabel } from "@/lib/invoices/build-invoices-export";

const escapeCsv = (value) => {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const fmtDate = (date) => new Date(date).toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels" });

/** Semicolon CSV with a UTF-8 BOM so Excel opens the accents correctly. */
export function buildInvoicesCsv({ filters, summary, rows }) {
  const lines = [
    ["Factures — Meri Beauty"],
    ["Période", invoicePeriodLabel(filters)],
    ["Origine", filters.sourceLabel],
    ["Paiement", filters.paymentLabel],
    ["Envoi", filters.deliveryLabel],
    [],
    ["N°", "Date", "Client", "N° TVA client", "Origine", "HT (€)", "TVA (€)", "TTC (€)", "Crédité (€)", "Net (€)", "Paiement", "Envoi"],
    ...rows.map((r) => [r.number, fmtDate(r.issuedAt), r.customerName, r.customerVatNumber ?? "", r.sourceLabel, r.amountHt, r.amountVat, r.amountTtc, r.credited, r.net, r.paymentLabel, r.sentLabel]),
    [],
    ["Total", "", "", "", "", summary.totalHt, summary.totalVat, summary.totalTtc, summary.credited, summary.net],
  ];
  return `\uFEFF${lines.map((line) => line.map(escapeCsv).join(";")).join("\r\n")}\r\n`;
}
