"use client";

import { useState } from "react";
import {
  Euro,
  Banknote,
  CreditCard,
  Globe,
  Undo2,
  ListOrdered,
  Download,
  FileSpreadsheet,
  ChevronRight,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination } from "@/components/dashboard/Tables/Pagination";

const PAGE_SIZE = 30;

const METHOD_ICONS = {
  CASH: <Banknote size={15} />,
  CARD: <CreditCard size={15} />,
  ONLINE: <Globe size={15} />,
};

const TYPE_LABELS = {
  DEPOSIT: "Acompte",
  FINAL_PAYMENT: "Solde",
  REFUND: "Remboursement",
};

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value ?? 0);
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("fr-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

function formatVatRate(rate) {
  if (rate == null) return "Taux inconnu";
  return `${rate} %`;
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values) {
  return values.map(escapeCsv).join(";");
}

/**
 * The journal is already filtered and freshly computed by the server, with
 * its running balance. Exporting this exact payload avoids a second,
 * potentially differently scoped query and guarantees the file matches the
 * figures on screen.
 */
function downloadRecettesCsv(data) {
  const { filters, summary, rows } = data;
  const lines = [
    ["Livre de recettes — Meri Beauty"],
    ["Période", `du ${filters.from} au ${filters.to}`],
    ["Moyen de paiement", filters.methodLabel],
    ["Catégorie", filters.categoryLabel],
    ["Exporté le", new Date().toLocaleString("fr-BE")],
    [],
    ["Synthèse", "Montant (€)"],
    ["Total net", summary.total],
    ["Recettes brutes", summary.grossInflow],
    ["Remboursements", summary.refundTotal],
    ["Nombre d'écritures", summary.count],
    [],
    ["Par moyen de paiement", "Net (€)", "Remboursé (€)"],
    ...summary.byMethod.map((m) => [m.label, m.net, m.refunded]),
    [],
    ["Par catégorie", "Net (€)"],
    ...summary.byCategory.map((c) => [c.label, c.net]),
    [],
    ["Par taux de TVA", "Base HT (€)", "TVA (€)", "TTC (€)"],
    ...summary.byVatRate.map((v) => [formatVatRate(v.rate), v.netAmount, v.vatAmount, v.grossAmount]),
    [],
    ["Date", "Pièce", "Référence", "Client", "Catégorie", "Libellé", "Méthode", "Type", "HT (€)", "TVA (€)", "TTC (€)", "Solde cumulé (€)"],
    ...rows.map((row) => [
      formatDateTime(row.paidAt),
      row.pieceNumber ?? "",
      row.reference ?? "",
      row.customerName ?? "",
      row.categoryLabel,
      row.label,
      row.methodLabel + (row.offTill ? " (hors caisse)" : ""),
      TYPE_LABELS[row.transactionType] ?? row.transactionType,
      row.amountHt == null ? "" : (row.isRefund ? -row.amountHt : row.amountHt),
      row.amountVat == null ? "" : (row.isRefund ? -row.amountVat : row.amountVat),
      row.isRefund ? -row.amountTtc : row.amountTtc,
      row.runningTotal,
    ]),
  ];

  // A UTF-8 BOM (﻿) makes accented French labels open correctly in Excel.
  const BOM = "﻿";
  const csv = `${BOM}${lines.map(csvRow).join("\r\n")}\r\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `livre-de-recettes-${filters.from}_${filters.to}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function RecettesJournalClient({ data }) {
  const { filters, summary, rows, truncated } = data;
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const excelParams = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.method !== "ALL") excelParams.set("method", filters.method);
  if (filters.category !== "ALL") excelParams.set("category", filters.category);

  const methodCard = (method) => summary.byMethod.find((m) => m.method === method) ?? { net: 0, refunded: 0 };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <a
          href={`/api/recettes/export?${excelParams.toString()}`}
          className="inline-flex items-center gap-2 rounded-[7px] bg-[#217346] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#185c37]"
        >
          <FileSpreadsheet className="h-4 w-4" strokeWidth={2} />
          Exporter Excel (.xlsx)
        </a>
        <button
          type="button"
          onClick={() => downloadRecettesCsv(data)}
          className="inline-flex items-center gap-2 rounded-[7px] border border-stroke bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-primary hover:text-primary dark:border-dark-3 dark:bg-gray-dark dark:text-dark-6"
        >
          <Download className="h-4 w-4" strokeWidth={2} />
          Exporter CSV
        </button>
      </div>

      {truncated && (
        <div
          role="alert"
          className="rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          Période trop large — affichage limité aux 5 000 premières écritures. Affinez les dates ou utilisez l'export.
        </div>
      )}

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard icon={<Euro size={20} />} label="Total net des recettes" value={formatEuro(summary.total)} />
        <StatCard
          icon={<Banknote size={20} />}
          label="Espèces"
          value={formatEuro(methodCard("CASH").net)}
          note={methodCard("CASH").refunded > 0 ? `−${formatEuro(methodCard("CASH").refunded)} remboursé` : null}
        />
        <StatCard
          icon={<CreditCard size={20} />}
          label="Carte (terminal)"
          value={formatEuro(methodCard("CARD").net)}
          note={methodCard("CARD").refunded > 0 ? `−${formatEuro(methodCard("CARD").refunded)} remboursé` : null}
        />
        <StatCard
          icon={<Globe size={20} />}
          label="En ligne (Stripe)"
          value={formatEuro(methodCard("ONLINE").net)}
          note={methodCard("ONLINE").refunded > 0 ? `−${formatEuro(methodCard("ONLINE").refunded)} remboursé` : null}
        />
        <StatCard icon={<Undo2 size={20} />} label="Remboursements" value={formatEuro(summary.refundTotal)} />
        <StatCard icon={<ListOrdered size={20} />} label="Écritures" value={summary.count} />
      </div>

      {/* ── VAT summary ───────────────────────────────────────────────────── */}
      {summary.byVatRate.length > 0 && (
        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <h2 className="mb-4 text-lg font-bold text-dark dark:text-white">Ventilation de la TVA</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Taux</TableHead>
                <TableHead className="text-right">Base HT</TableHead>
                <TableHead className="text-right">TVA</TableHead>
                <TableHead className="text-right">TTC</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.byVatRate.map((v) => (
                <TableRow key={v.rate ?? "unknown"}>
                  <TableCell>{formatVatRate(v.rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(v.netAmount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(v.vatAmount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(v.grossAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {summary.byVatRate.some((v) => v.rate == null) && (
            <p className="mt-3 text-xs text-gray-500 dark:text-dark-6">
              « Taux inconnu » : paiement encaissé avant émission de la facture — la TVA n'y est pas encore
              rattachée à un taux.
            </p>
          )}
        </div>
      )}

      {/* ── Journal ───────────────────────────────────────────────────────── */}
      <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stroke px-6 py-4 dark:border-dark-3">
          <h2 className="text-lg font-bold text-dark dark:text-white">
            Journal — {rows.length} écriture{rows.length > 1 ? "s" : ""}
          </h2>
          <span className="text-sm text-gray-500 dark:text-dark-6">
            du {filters.from} au {filters.to}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-gray-400">Aucune recette sur cette période.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Date</TableHead>
                  <TableHead>Pièce / Réf.</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Méthode</TableHead>
                  <TableHead className="text-right">HT</TableHead>
                  <TableHead className="text-right">TVA</TableHead>
                  <TableHead className="text-right">TTC</TableHead>
                  <TableHead className="text-right">Solde cumulé</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((row) => {
                  const isOpen = expanded === row.id;
                  return (
                    <FragmentRow
                      key={row.id}
                      row={row}
                      isOpen={isOpen}
                      onToggle={() => setExpanded(isOpen ? null : row.id)}
                    />
                  );
                })}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex justify-center border-t border-stroke px-6 py-4 dark:border-dark-3">
                <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FragmentRow({ row, isOpen, onToggle }) {
  const sign = row.isRefund ? -1 : 1;
  const amountClass = row.isRefund ? "text-red-600 dark:text-red-400" : "text-dark dark:text-white";

  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle} data-state={isOpen ? "selected" : undefined}>
        <TableCell className="pr-0 text-gray-400">
          <ChevronRight size={15} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
        </TableCell>
        <TableCell className="whitespace-nowrap tabular-nums">{formatDateTime(row.paidAt)}</TableCell>
        <TableCell className="whitespace-nowrap text-gray-500 dark:text-dark-6">
          {row.pieceNumber || row.reference || "—"}
        </TableCell>
        <TableCell className="max-w-[180px] truncate">{row.customerName ?? "—"}</TableCell>
        <TableCell>{row.categoryLabel}</TableCell>
        <TableCell>
          <span className="inline-flex items-center gap-1.5">
            {METHOD_ICONS[row.method]}
            {row.methodLabel}
            {row.offTill && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                hors caisse
              </span>
            )}
          </span>
        </TableCell>
        <TableCell className="text-right tabular-nums text-gray-500 dark:text-dark-6">
          {row.amountHt == null ? "—" : formatEuro(sign * row.amountHt)}
        </TableCell>
        <TableCell className="text-right tabular-nums text-gray-500 dark:text-dark-6">
          {row.amountVat == null ? "—" : formatEuro(sign * row.amountVat)}
        </TableCell>
        <TableCell className={`text-right font-semibold tabular-nums ${amountClass}`}>
          {formatEuro(sign * row.amountTtc)}
        </TableCell>
        <TableCell className="text-right tabular-nums text-dark dark:text-white">{formatEuro(row.runningTotal)}</TableCell>
      </TableRow>
      {isOpen && (
        <TableRow className="bg-neutral-50 dark:bg-dark-2">
          <TableCell colSpan={10} className="text-sm">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
              <DetailItem label="Libellé" value={row.label} />
              <DetailItem label="Type" value={TYPE_LABELS[row.transactionType] ?? row.transactionType} />
              <DetailItem label="Taux de TVA" value={formatVatRate(row.vatRate)} />
              <DetailItem label="N° de pièce" value={row.pieceNumber ?? "—"} />
              <DetailItem label="Référence" value={row.reference ?? "—"} />
              <DetailItem label="Client" value={row.customerName ? `${row.customerName}${row.customerEmail ? ` · ${row.customerEmail}` : ""}` : "—"} />
            </dl>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function DetailItem({ label, value }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-dark dark:text-white">{value}</dd>
    </div>
  );
}

function StatCard({ icon, label, value, note }) {
  return (
    <div className="flex items-center gap-4 rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-dark dark:text-white">{value}</p>
        <p className="truncate text-sm text-gray-500 dark:text-dark-6">{label}</p>
        {note && <p className="text-xs text-red-500">{note}</p>}
      </div>
    </div>
  );
}
