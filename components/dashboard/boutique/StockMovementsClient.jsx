"use client";

import { useMemo } from "react";
import { Printer, ListOrdered } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { groupMovementsByDay, formatDayLabel } from "@/lib/stock/movement-day-groups";

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

/**
 * On-screen "Mouvements de stock" ledger — every InventoryMovement across
 * every variant, day-grouped, mirroring RecettesJournalClient.jsx. This is
 * the direct answer to "where do stock adjustments go": an ADJUSTMENT row is
 * a normal row here, filterable and visible without opening the per-variant
 * history drawer or a PDF.
 */
export function StockMovementsClient({ data }) {
  const { filters, summary, rows, truncated } = data;
  const dayGroups = useMemo(() => groupMovementsByDay(rows), [rows]);

  const queryParams = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.type !== "ALL") queryParams.set("type", filters.type);

  const nonZeroTypes = summary.byType.filter((t) => t.count > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <a
          href={`/api/stock/movements-pdf?${queryParams.toString()}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-[7px] border border-stroke bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-primary hover:text-primary dark:border-dark-3 dark:bg-gray-dark dark:text-dark-6"
        >
          <Printer className="h-4 w-4" strokeWidth={2} />
          Imprimer (PDF)
        </a>
      </div>

      {truncated && (
        <div
          role="alert"
          className="rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          Période trop large — affichage limité aux 5 000 premiers mouvements. Affinez les dates ou le type.
        </div>
      )}

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        <StatCard icon={<ListOrdered size={20} />} label="Total mouvements" value={summary.count} />
        {nonZeroTypes.map((t) => (
          <StatCard key={t.type} label={t.label} value={t.count} />
        ))}
      </div>

      {/* ── Day-grouped ledger ────────────────────────────────────────────── */}
      <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        {dayGroups.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <p className="font-medium text-gray-700 dark:text-white">Aucun mouvement sur cette période.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Date</TableHead>
                <TableHead>Produit</TableHead>
                <TableHead>Référence</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Quantité</TableHead>
                <TableHead>Stock avant → après</TableHead>
                <TableHead>Motif</TableHead>
                <TableHead className="pr-6">Par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dayGroups.map((group) => (
                <DayGroupRows key={group.key} group={group} />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function DayGroupRows({ group }) {
  return (
    <>
      <TableRow className="bg-gray-50/80 dark:bg-dark-2/60">
        <TableCell colSpan={8} className="py-2 pl-6 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6">
          {formatDayLabel(group.date)} ({group.rows.length} mouvement{group.rows.length > 1 ? "s" : ""})
        </TableCell>
      </TableRow>
      {group.rows.map((row) => (
        <TableRow key={row.id}>
          <TableCell className="pl-6 text-gray-600 dark:text-dark-6">{formatDateTime(row.createdAt)}</TableCell>
          <TableCell>
            <div className="font-medium text-gray-800 dark:text-white">{row.productName}</div>
            <div className="text-xs text-gray-400">{row.variantName}</div>
          </TableCell>
          <TableCell className="text-gray-600 dark:text-dark-6">{row.sku}</TableCell>
          <TableCell className="text-gray-600 dark:text-dark-6">{row.typeLabel}</TableCell>
          <TableCell>
            <span className={`font-semibold ${row.quantity > 0 ? "text-emerald-600" : "text-red-500"}`}>
              {row.quantity > 0 ? "+" : ""}
              {row.quantity}
            </span>
          </TableCell>
          <TableCell className="text-gray-500">
            {row.previousStock} → {row.newStock}
          </TableCell>
          <TableCell className="max-w-[220px] truncate text-gray-500" title={row.reason ?? ""}>
            {row.reason ?? "—"}
          </TableCell>
          <TableCell className="pr-6 text-gray-500">{row.createdByName ?? "—"}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      {icon && <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#2f3a2e]/10 text-[#2f3a2e]">{icon}</span>}
      <div className="min-w-0">
        <div className="text-xs font-medium text-gray-500 dark:text-dark-6">{label}</div>
        <div className="text-lg font-bold text-dark dark:text-white">{value}</div>
      </div>
    </div>
  );
}
