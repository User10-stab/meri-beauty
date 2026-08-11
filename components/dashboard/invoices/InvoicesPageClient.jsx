"use client";

import { useMemo, useState } from "react";
import { Search, Receipt, Download, FileMinus } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const SOURCE_LABEL = {
  ORDER: "Commande",
  APPOINTMENT: "Rendez-vous",
};

const SOURCE_STYLE = {
  ORDER: "bg-blue-50 text-blue-700 border-blue-100",
  APPOINTMENT: "bg-violet-50 text-violet-700 border-violet-100",
};

function formatPrice(n) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(n);
}

function formatDate(d) {
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Brussels" });
}

export function InvoicesPageClient({ initialInvoices }) {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialInvoices.filter((inv) => {
      if (q) {
        const hay = `${inv.number} ${inv.customerName} ${inv.customerEmail}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (sourceFilter && inv.source !== sourceFilter) return false;
      return true;
    });
  }, [initialInvoices, search, sourceFilter]);

  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex flex-col gap-3 border-b border-stroke px-6 py-4 dark:border-dark-3 sm:flex-row sm:items-center">
        <div className="relative w-full max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher n°, client…"
            className="h-9 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
        </div>

        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        >
          <option value="">Toutes les sources</option>
          {Object.entries(SOURCE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-50">
            <Receipt size={22} className="text-gray-300" />
          </div>
          <p className="font-medium text-gray-700">
            {initialInvoices.length > 0 ? "Aucune facture ne correspond à votre recherche" : "Aucune facture pour le moment"}
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">N° facture</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Total TTC</TableHead>
              <TableHead className="pr-6 text-right">Documents</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell className="pl-6">
                  <span className="font-medium text-gray-800 dark:text-white">{inv.number}</span>
                  {inv.orderNumber && <span className="block text-xs text-gray-400">Commande n°{inv.orderNumber}</span>}
                </TableCell>
                <TableCell>
                  <span className="text-gray-700 dark:text-dark-6">{inv.customerName}</span>
                  <span className="block text-xs text-gray-400">{inv.customerEmail}</span>
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${SOURCE_STYLE[inv.source]}`}>
                    {SOURCE_LABEL[inv.source]}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-gray-500 dark:text-dark-6">{formatDate(inv.issuedAt)}</span>
                </TableCell>
                <TableCell>
                  <span className="font-medium text-gray-700 dark:text-dark-6">{formatPrice(inv.totalInclVat)}</span>
                </TableCell>
                <TableCell className="pr-6">
                  <div className="flex flex-col items-end gap-1.5">
                    <a
                      href={`/api/invoices/${inv.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#2f3a2e] px-3 py-1.5 text-xs font-medium text-[#2f3a2e] transition-colors hover:bg-[#2f3a2e] hover:text-white"
                    >
                      <Download size={12} /> Facture
                    </a>
                    {inv.creditNotes.map((cn) => (
                      <a
                        key={cn.id}
                        href={`/api/credit-notes/${cn.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                      >
                        <FileMinus size={12} /> {cn.number}
                      </a>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
