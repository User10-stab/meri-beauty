"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Wallet,
  BookOpen,
  Printer,
  Download,
  FileSpreadsheet,
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Landmark,
  ChevronRight,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  History,
} from "lucide-react";
import { toast } from "sonner";
import Button from "@/components/ui/Button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { openCashSession } from "@/actions/dashboard/cash-sessions";
import { recordCashMovement } from "@/actions/dashboard/cash-movements";
import { CaisseFilterBar } from "@/components/dashboard/boutique/caisse/CaisseFilterBar";
import { groupLedgerRowsByDay, formatDayLabel } from "@/lib/cash-book/day-groups";
import { CASH_MOVEMENT_TYPE_LABELS } from "@/lib/cash-book/movement-types";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });
}

function formatDateOnly(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { dateStyle: "medium", timeZone: "Europe/Brussels" });
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values) {
  return values.map(escapeCsv).join(";");
}

const ROW_STYLES = {
  OPENING: "font-semibold text-gray-900 dark:text-white",
  REFUND: "text-red-600",
  EXPENSE: "text-red-600",
  WITHDRAWAL: "text-red-600",
};

// Whole-row tint by movement kind: Apport reads as money safely in the
// drawer (green), Dépense/Transfert de banque as money leaving it (red) —
// applied to the <TableRow> itself rather than just the Désignation cell so
// the category is readable at a glance down the whole line.
const ROW_TINTS = {
  CASH_IN: "bg-emerald-50 dark:bg-emerald-500/10",
  EXPENSE: "bg-red-50 dark:bg-red-500/10",
  WITHDRAWAL: "bg-red-50 dark:bg-red-500/10",
};

// Same categories, but for the Entrées/Sorties/Désignation text color —
// darker than the row tint so it stays legible against it.
const ROW_TEXT_TINTS = {
  CASH_IN: "text-emerald-700 dark:text-emerald-400",
  EXPENSE: "text-red-700 dark:text-red-400",
  WITHDRAWAL: "text-red-700 dark:text-red-400",
};

// Dépense/Transfert de banque render their Sorties amount as a negative
// number (e.g. -220,00 €) instead of a plain positive figure, per Marie's
// request — Apport/ventes keep their ordinary positive formatting.
const NEGATIVE_DISPLAY_KINDS = new Set(["EXPENSE", "WITHDRAWAL"]);

const MOVEMENT_TYPES = [
  { value: "EXPENSE", label: CASH_MOVEMENT_TYPE_LABELS.EXPENSE, hint: "Argent sorti du tiroir pour un achat (emballages, transport, fournisseur...)" },
  { value: "CASH_IN", label: CASH_MOVEMENT_TYPE_LABELS.CASH_IN, hint: "Argent ajouté au tiroir hors vente (appoint de monnaie...)" },
  { value: "WITHDRAWAL", label: CASH_MOVEMENT_TYPE_LABELS.WITHDRAWAL, hint: "Argent sorti pour être déposé en banque" },
];

// Same linking rule as the old CashBookClient: a drawer movement has no
// Payment at all and never gets a link; a REFUND links to the payment's
// ticket without a transactionId (a REFUND transactionType never resolves
// as its own collection); a SALE links to its own collection directly.
function pieceNumberHref(row) {
  if (row.kind !== "SALE" && row.kind !== "REFUND") return null;
  if (row.orderId) return `/api/orders/${row.orderId}/ticket`;
  if (row.paymentId && row.kind === "SALE") return `/api/payments/${row.paymentId}/ticket?transactionId=${row.transactionId}`;
  if (row.paymentId) return `/api/payments/${row.paymentId}/ticket`;
  return null;
}

/**
 * The ledger and report are already filtered and freshly computed by the
 * server, with the ledger's own running balance — exporting this exact
 * payload avoids a second, potentially differently scoped query and
 * guarantees the file matches the figures on screen. Same approach as the
 * Livre de recettes' own downloadRecettesCsv.
 */
function downloadCaisseCsv({ ledger, report }) {
  const { filters, totals, rows } = ledger;
  const lines = [
    ["Livre de caisse — Meri Beauty"],
    ["Période", `du ${filters.from} au ${filters.to}`],
    ["Exporté le", new Date().toLocaleString("fr-BE")],
    [],
    ["Synthèse", "Montant (€)"],
    ["Total entrées", totals.entrees],
    ["Total sorties", totals.sorties],
    ["Solde", totals.finalBalance],
    ["Nombre d'écritures", rows.length],
  ];

  if (report) {
    lines.push(
      [],
      ["Ventes espèces par catégorie", "Nb", "Net (€)"],
      ...Object.entries(report.byCategory).map(([label, net]) => [label, report.byCategoryCounts?.[label] ?? "", net]),
      [],
      ["TVA sur les ventes espèces", "Nb", "Base HT (€)", "TVA (€)", "Total TTC (€)"],
      ...report.byVatRate.map((r) => [`${r.rate}%`, r.count, r.netAmount, r.vatAmount, r.grossAmount]),
      [],
      ["Réconciliation caisse", "Montant (€)"],
      ["Mouvements — apports", report.cashMovements.in],
      ["Mouvements — sorties", -report.cashMovements.out],
      ...(report.expectedCash != null ? [["Attendu en caisse", report.expectedCash]] : []),
      [],
      ["Comparaison", `du ${formatDateOnly(report.previousPeriod.from)} au ${formatDateOnly(report.previousPeriod.to)}`],
      ["Ventes espèces — période précédente", report.previousPeriod.totalSales],
      ["Entrées — période précédente", report.previousPeriod.entrees],
      ["Sorties — période précédente", report.previousPeriod.sorties],
      ["Solde — période précédente", report.previousPeriod.finalBalance]
    );

    if (report.sessions.length > 0) {
      lines.push(
        [],
        ["Sessions de caisse", "Ouverture", "Clôture", "Fond initial (€)", "Compté (€)", "Écart (€)", "Type"],
        ...report.sessions.map((s) => [
          "",
          formatDateTime(s.openedAt),
          s.closedAt ? formatDateTime(s.closedAt) : "En cours",
          s.openingFloat,
          s.countedCash ?? "",
          s.variance ?? "",
          !s.closedAt ? "" : s.isAutoClosed ? "Auto" : "Manuel",
        ])
      );
    }
  }

  lines.push(
    [],
    ["Date", "N° pièce", "Référence", "Désignation", "Entrées (€)", "Sorties (€)", "Solde (€)"],
    ...rows.map((row) => [
      formatDateTime(row.date),
      row.pieceNumber ?? "",
      row.reference ?? "",
      row.label,
      row.entree || "",
      row.sortie ? (NEGATIVE_DISPLAY_KINDS.has(row.kind) ? -row.sortie : row.sortie) : "",
      row.solde,
    ])
  );

  // A UTF-8 BOM (﻿) makes accented French labels open correctly in Excel.
  const BOM = "﻿";
  const csv = `${BOM}${lines.map(csvRow).join("\r\n")}\r\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `livre-de-caisse-${filters.from}_${filters.to}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * The Livre de caisse on one page: current balance + zero-fund banner, a
 * manual-open fallback (auto-open normally covers this — see
 * lib/cash-book/auto-session.js), date-range filters, movement entry
 * (apport/dépense/transfert), the journal grouped day by day (same
 * collapsible pattern as the Livre de recettes), and the "Rapport" — cash
 * sales by category/VAT plus the cash reconciliation, over the same range —
 * rendered inline below the journal rather than behind a separate route, so
 * there is nothing to click through to see it. The report is deliberately
 * CASH-only: a CARD/ONLINE sale never touched this drawer, so it has no
 * place in this book's own report (that fuller picture is the Livre de
 * recettes). Replaces the old caisse / caisse/[sessionId] /
 * caisse/[sessionId]/rapport / caisse/depots four-page flow.
 */
export function CaisseClient({
  ledger,
  ledgerError,
  report,
  reportError,
  currentSession,
  suggestedOpeningFloat,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openingFloat, setOpeningFloat] = useState(() => (suggestedOpeningFloat != null ? String(suggestedOpeningFloat) : ""));
  const [movementType, setMovementType] = useState("EXPENSE");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementLabel, setMovementLabel] = useState("");
  const [expandedDays, setExpandedDays] = useState(() => new Set());

  const dayGroups = useMemo(() => (ledger?.rows ? groupLedgerRowsByDay(ledger.rows) : []), [ledger?.rows]);

  const finalBalance = ledger?.totals?.finalBalance ?? currentSession?.expectedCash ?? null;
  const isZero = finalBalance != null && Math.abs(finalBalance) < 0.005;

  const exportQuery = ledger?.filters
    ? new URLSearchParams({ from: ledger.filters.from, to: ledger.filters.to }).toString()
    : "";

  function toggleDay(key) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleOpen() {
    const amount = Number(openingFloat);
    if (!Number.isFinite(amount) || amount < 0) return toast.error("Indiquez un fond de caisse valide.");
    startTransition(async () => {
      const result = await openCashSession(amount);
      if (!result.success) return toast.error(result.message);
      toast.success("Caisse ouverte.");
      router.refresh();
    });
  }

  function handleMovementSubmit(event) {
    event.preventDefault();
    const value = Number(movementAmount);
    if (!Number.isFinite(value) || value <= 0) return toast.error("Indiquez un montant strictement positif.");
    startTransition(async () => {
      const result = await recordCashMovement({ type: movementType, amount: value, label: movementLabel.trim() });
      if (!result.success) return toast.error(result.message);
      toast.success(`${result.data.pieceNumber} enregistré.`);
      setMovementAmount("");
      setMovementLabel("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-[#2f3a2e]" />
            <h1 className="text-2xl font-bold text-dark dark:text-white">Livre de caisse</h1>
          </div>
          <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
            Journal des mouvements en espèces — ouverture et clôture automatiques selon l'horaire du salon.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/caisse/export?${exportQuery}`}
            className="inline-flex items-center gap-2 rounded-[7px] bg-[#217346] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#185c37]"
          >
            <FileSpreadsheet className="h-4 w-4" strokeWidth={2} />
            Exporter Excel (.xlsx)
          </a>
          <button
            type="button"
            onClick={() => ledger && downloadCaisseCsv({ ledger, report })}
            disabled={!ledger}
            className="inline-flex items-center gap-2 rounded-[7px] border border-stroke bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-3 dark:bg-gray-dark dark:text-dark-6"
          >
            <Download className="h-4 w-4" strokeWidth={2} />
            Exporter CSV
          </button>
          <a
            href={`/api/caisse/pdf?${exportQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-[7px] border border-stroke bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-primary hover:text-primary dark:border-dark-3 dark:bg-gray-dark dark:text-dark-6"
          >
            <Printer className="h-4 w-4" strokeWidth={2} />
            Imprimer (PDF)
          </a>
        </div>
      </div>

      {isZero && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">La caisse est à zéro.</p>
            <p>Pensez à remettre les fonds (apport) avant la prochaine vente en espèces.</p>
          </div>
        </div>
      )}

      <div className="rounded-[10px] border border-stroke bg-white p-5 shadow-1 print:hidden dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        {currentSession ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">Session ouverte</h2>
              <p className="text-gray-600 dark:text-dark-6">
                Ouverte le {formatDateTime(currentSession.openedAt)}
                {currentSession.isAutoOpened ? " (automatique)" : ` par ${currentSession.openedBy?.fullName ?? "—"}`} — fond{" "}
                {formatEuro(currentSession.openingFloat)}.
              </p>
            </div>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
              Caisse ouverte
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">Aucune session ouverte</h2>
              <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="opening-float">
                Fond de caisse
              </label>
              <input
                id="opening-float"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={openingFloat}
                onChange={(event) => setOpeningFloat(event.target.value)}
                placeholder="0.00"
                className="h-10 w-40 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              />
            </div>
            <Button onClick={handleOpen} disabled={isPending}>
              <Wallet size={16} />
              Ouvrir la caisse
            </Button>
          </div>
        )}
      </div>

      <div className="print:hidden">
        <CaisseFilterBar filters={ledger?.filters} />
      </div>

      {currentSession && (
        <form
          onSubmit={handleMovementSubmit}
          className="flex flex-wrap items-end gap-3 rounded-[10px] border border-stroke bg-white p-5 shadow-1 print:hidden dark:border-dark-3 dark:bg-gray-dark dark:shadow-card"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="movement-type">Mouvement</label>
            <select
              id="movement-type"
              value={movementType}
              onChange={(event) => setMovementType(event.target.value)}
              className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            >
              {MOVEMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="movement-amount">Montant</label>
            <input
              id="movement-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              value={movementAmount}
              onChange={(event) => setMovementAmount(event.target.value)}
              placeholder="0.00"
              className="h-10 w-32 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="movement-label">
              Motif (optionnel)
            </label>
            <input
              id="movement-label"
              type="text"
              value={movementLabel}
              onChange={(event) => setMovementLabel(event.target.value)}
              placeholder={`Vide → Désignation "${CASH_MOVEMENT_TYPE_LABELS[movementType]}" — ou précisez : ${MOVEMENT_TYPES.find((t) => t.value === movementType)?.hint ?? ""}`}
              maxLength={200}
              className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
          <Button type="submit" disabled={isPending}>
            {movementType === "CASH_IN" ? <ArrowUpCircle size={16} /> : movementType === "WITHDRAWAL" ? <Landmark size={16} /> : <ArrowDownCircle size={16} />}
            Enregistrer
          </Button>
        </form>
      )}

      {ledgerError ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {ledgerError}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
            <StatCard
              icon={<ArrowUpCircle size={20} />}
              label="Total entrées"
              value={formatEuro(ledger.totals.entrees)}
              delta={report && <DeltaBadge current={ledger.totals.entrees} previous={report.previousPeriod.entrees} />}
            />
            <StatCard
              icon={<ArrowDownCircle size={20} />}
              label="Total sorties"
              value={formatEuro(ledger.totals.sorties)}
              delta={report && <DeltaBadge current={ledger.totals.sorties} previous={report.previousPeriod.sorties} invert />}
            />
            <StatCard
              icon={<Wallet size={20} />}
              label="Solde"
              value={formatEuro(ledger.totals.finalBalance)}
              delta={report && <DeltaBadge current={ledger.totals.finalBalance} previous={report.previousPeriod.finalBalance} />}
            />
          </div>

          <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card print:border-0 print:shadow-none">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stroke px-6 py-4 dark:border-dark-3 print:px-0">
              <h2 className="text-lg font-bold text-dark dark:text-white">
                Journal — {ledger.rows.length} mouvement{ledger.rows.length > 1 ? "s" : ""}
              </h2>
              <span className="text-sm text-gray-500 dark:text-dark-6 print:hidden">
                du {ledger.filters.from} au {ledger.filters.to}
              </span>
            </div>

            {dayGroups.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-gray-400">Aucun mouvement sur cette période.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Date</TableHead>
                    <TableHead>N° pièce</TableHead>
                    <TableHead>Réf.</TableHead>
                    <TableHead>Désignation</TableHead>
                    <TableHead className="text-right">Entrées</TableHead>
                    <TableHead className="text-right">Sorties</TableHead>
                    <TableHead className="text-right">Cumul</TableHead>
                  </TableRow>
                </TableHeader>
                {dayGroups.map((group) => (
                  <DayGroup
                    key={group.key}
                    group={group}
                    isOpen={expandedDays.has(group.key)}
                    onToggle={() => toggleDay(group.key)}
                  />
                ))}
              </Table>
            )}
          </div>
        </>
      )}

      {reportError ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {reportError}
        </div>
      ) : (
        report && (
          <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card print:border-0 print:shadow-none">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stroke px-6 py-4 dark:border-dark-3 print:px-0">
              <div className="flex items-center gap-2">
                <BarChart3 size={18} className="text-[#2f3a2e]" />
                <h2 className="text-lg font-bold text-dark dark:text-white">Rapport</h2>
              </div>
              <span className="text-right text-sm text-gray-500 dark:text-dark-6 print:hidden">
                <span className="block">Ventes espèces uniquement — même période que le journal</span>
                <span className="block text-xs text-gray-400">
                  vs. du {formatDateOnly(report.previousPeriod.from)} au {formatDateOnly(report.previousPeriod.to)}
                </span>
              </span>
            </div>

            <div className="space-y-4 p-5 print:px-0">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Ventes espèces par catégorie</h3>
                  {Object.keys(report.byCategory).length === 0 ? (
                    <p className="text-sm text-gray-400">Aucune vente en espèces sur cette période.</p>
                  ) : (
                    <>
                      <div className="divide-y divide-gray-100 dark:divide-dark-3">
                        {Object.entries(report.byCategory).map(([category, amount]) => (
                          <SummaryRow key={category} label={category} value={amount} count={report.byCategoryCounts?.[category]} />
                        ))}
                      </div>
                      <div className="mt-2 border-t border-gray-200 pt-2 dark:border-dark-3">
                        <SummaryRow
                          label="Total ventes espèces"
                          value={report.totalSales}
                          emphasis
                          delta={<DeltaBadge current={report.totalSales} previous={report.previousPeriod.totalSales} />}
                        />
                      </div>
                    </>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                    <Wallet size={15} />
                    Réconciliation caisse
                  </h3>
                  <div className="divide-y divide-gray-100 dark:divide-dark-3">
                    <SummaryRow label="Mouvements — apports" value={report.cashMovements.in} />
                    <SummaryRow label="Mouvements — sorties" value={-report.cashMovements.out} />
                    {report.expectedCash != null && <SummaryRow label="Attendu en caisse" value={report.expectedCash} emphasis />}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">TVA sur les ventes espèces</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-stroke text-xs uppercase text-gray-400 dark:border-dark-3">
                      <tr>
                        <th className="py-2 pr-4">Taux</th>
                        <th className="py-2 pr-4 text-right">Nb</th>
                        <th className="py-2 pr-4 text-right">Base HT</th>
                        <th className="py-2 pr-4 text-right">TVA</th>
                        <th className="py-2 pr-4 text-right">Total TTC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-dark-3">
                      {report.byVatRate.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-gray-400">
                            Aucune vente en espèces sur cette période.
                          </td>
                        </tr>
                      ) : (
                        report.byVatRate.map((row) => (
                          <tr key={row.rate}>
                            <td className="py-2 pr-4">{row.rate}%</td>
                            <td className="py-2 pr-4 text-right text-gray-400">{row.count}</td>
                            <td className="py-2 pr-4 text-right">{formatEuro(row.netAmount)}</td>
                            <td className="py-2 pr-4 text-right">{formatEuro(row.vatAmount)}</td>
                            <td className="py-2 pr-4 text-right font-medium">{formatEuro(row.grossAmount)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {report.sessions.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                    <History size={15} />
                    Sessions de caisse
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-stroke text-xs uppercase text-gray-400 dark:border-dark-3">
                        <tr>
                          <th className="py-2 pr-4">Ouverture</th>
                          <th className="py-2 pr-4">Clôture</th>
                          <th className="py-2 pr-4 text-right">Fond initial</th>
                          <th className="py-2 pr-4 text-right">Compté</th>
                          <th className="py-2 pr-4 text-right">Écart</th>
                          <th className="py-2 pr-4">Type</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-dark-3">
                        {report.sessions.map((session) => (
                          <tr key={session.id}>
                            <td className="whitespace-nowrap py-2 pr-4">{formatDateTime(session.openedAt)}</td>
                            <td className="whitespace-nowrap py-2 pr-4">
                              {session.closedAt ? (
                                formatDateTime(session.closedAt)
                              ) : (
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">En cours</span>
                              )}
                            </td>
                            <td className="py-2 pr-4 text-right">{formatEuro(session.openingFloat)}</td>
                            <td className="py-2 pr-4 text-right">
                              {session.countedCash != null ? formatEuro(session.countedCash) : "—"}
                            </td>
                            <td
                              className={`py-2 pr-4 text-right font-medium ${
                                session.variance ? (session.variance < 0 ? "text-red-600" : "text-emerald-600") : ""
                              }`}
                            >
                              {session.variance != null ? formatEuro(session.variance) : "—"}
                            </td>
                            <td className="py-2 pr-4 text-xs text-gray-400">
                              {!session.closedAt ? "—" : session.isAutoClosed ? "Auto" : "Manuel"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function SummaryRow({ label, value, emphasis = false, count, delta }) {
  return (
    <div className={`flex items-center justify-between py-1.5 text-sm ${emphasis ? "font-semibold text-gray-900 dark:text-white" : "text-gray-600 dark:text-dark-6"}`}>
      <span>
        {label}
        {count != null && <span className="ml-1.5 text-xs font-normal text-gray-400">({count})</span>}
      </span>
      <span className="inline-flex items-center gap-2">
        {formatEuro(value)}
        {delta}
      </span>
    </div>
  );
}

function DayGroup({ group, isOpen, onToggle }) {
  return (
    <TableBody className="print:break-inside-avoid">
      <TableRow
        className="cursor-pointer bg-neutral-50 font-semibold dark:bg-dark-2 print:break-inside-avoid"
        onClick={onToggle}
      >
        <TableCell className="pr-0 text-gray-400">
          <ChevronRight size={15} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
        </TableCell>
        <TableCell colSpan={4} className="whitespace-nowrap">
          {formatDayLabel(group.date)}
          <span className="ml-2 text-xs font-normal text-gray-400">
            ({group.rows.length} mouvement{group.rows.length > 1 ? "s" : ""})
          </span>
        </TableCell>
        <TableCell className="text-right tabular-nums">{formatEuro(group.totalEntrees)}</TableCell>
        <TableCell className="text-right tabular-nums">{formatEuro(group.totalSorties)}</TableCell>
        <TableCell className="text-right tabular-nums">{formatEuro(group.closingBalance)}</TableCell>
      </TableRow>
      {isOpen &&
        group.rows.map((row, index) => {
          const href = pieceNumberHref(row);
          const rowKey = `${row.kind}-${row.pieceNumber ?? index}-${row.date}`;
          const textTint = ROW_TEXT_TINTS[row.kind] ?? ROW_STYLES[row.kind] ?? "";
          const sortieDisplay = row.sortie
            ? formatEuro(NEGATIVE_DISPLAY_KINDS.has(row.kind) ? -row.sortie : row.sortie)
            : "—";
          return (
            <TableRow key={rowKey} className={ROW_TINTS[row.kind] ?? ""}>
              <TableCell />
              <TableCell className="whitespace-nowrap tabular-nums">{formatDateTime(row.date)}</TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs">
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#2f3a2e] hover:underline dark:text-white">
                    {row.pieceNumber}
                  </a>
                ) : (
                  row.pieceNumber ?? "—"
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs">{row.reference ?? "—"}</TableCell>
              <TableCell className={textTint}>{row.label}</TableCell>
              <TableCell className={`text-right tabular-nums ${textTint}`}>{row.entree ? formatEuro(row.entree) : "—"}</TableCell>
              <TableCell className={`text-right tabular-nums ${textTint}`}>{sortieDisplay}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums text-gray-900 dark:text-white">
                {formatEuro(row.solde)}
              </TableCell>
            </TableRow>
          );
        })}
      {isOpen && (
        <TableRow className="border-t-2 border-stroke bg-neutral-50 font-semibold dark:border-dark-3 dark:bg-dark-2 print:break-inside-avoid">
          <TableCell />
          <TableCell colSpan={4}>Total du jour</TableCell>
          <TableCell className="text-right tabular-nums">{formatEuro(group.totalEntrees)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatEuro(group.totalSorties)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatEuro(group.closingBalance)}</TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}

function StatCard({ icon, label, value, delta }) {
  return (
    <div className="flex items-center gap-4 rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card print:gap-2 print:p-2 print:shadow-none">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white print:hidden">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-xl font-bold text-dark dark:text-white print:text-base">{value}</p>
          {delta}
        </div>
        <p className="truncate text-sm text-gray-500 dark:text-dark-6">{label}</p>
      </div>
    </div>
  );
}

/**
 * A small % vs. période précédente indicator, reused across the top stat
 * cards and the Rapport's own "Total ventes espèces" row — same
 * previousPeriod figures (lib/cash-book/build-day-report.js), one at-a-glance
 * convention instead of each caller inventing its own.
 * `invert` flips the color story for metrics where "up" is unwelcome
 * (Sorties: more cash going out is not the good direction).
 */
function DeltaBadge({ current, previous, invert = false }) {
  if (current == null || previous == null) return null;
  if (previous === 0) {
    if (current === 0) return null;
    return (
      <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium text-emerald-600 print:hidden dark:text-emerald-400">
        <ArrowUpRight size={12} />
        nouveau
      </span>
    );
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 0.5) {
    return <span className="whitespace-nowrap text-xs font-medium text-gray-400 print:hidden">stable</span>;
  }
  const isIncrease = pct > 0;
  const isPositive = invert ? !isIncrease : isIncrease;
  const Icon = isIncrease ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium print:hidden ${
        isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
      }`}
    >
      <Icon size={12} />
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}
