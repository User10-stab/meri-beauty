"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Wallet,
  BookOpen,
  Printer,
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Landmark,
  ChevronRight,
  ClipboardCheck,
  Calculator,
  BarChart3,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import Button from "@/components/ui/Button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { openCashSession } from "@/actions/dashboard/cash-sessions";
import { recordCashMovement } from "@/actions/dashboard/cash-movements";
import { verifyCashSessionBalance } from "@/actions/dashboard/cash-session-verification";
import { DenominationCounter } from "@/components/dashboard/boutique/DenominationCounter";
import { CaisseFilterBar } from "@/components/dashboard/boutique/caisse/CaisseFilterBar";
import { CaissePrintHeader } from "@/components/dashboard/boutique/caisse/CaissePrintHeader";
import { groupLedgerRowsByDay, formatDayLabel } from "@/lib/cash-book/day-groups";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });
}

const ROW_STYLES = {
  OPENING: "font-semibold text-gray-900 dark:text-white",
  REFUND: "text-red-600",
  EXPENSE: "text-red-600",
  WITHDRAWAL: "text-red-600",
};

const MOVEMENT_TYPES = [
  { value: "EXPENSE", label: "Dépense", hint: "Argent sorti du tiroir pour un achat (emballages, transport, fournisseur...)" },
  { value: "CASH_IN", label: "Apport", hint: "Argent ajouté au tiroir hors vente (appoint de monnaie...)" },
  { value: "WITHDRAWAL", label: "Transfert de banque", hint: "Argent sorti pour être déposé en banque" },
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
 * The Livre de caisse's journal on one page: current balance + zero-fund
 * banner, a manual-open fallback (auto-open normally covers this — see
 * lib/cash-book/auto-session.js), date-range filters, movement entry
 * (apport/dépense/transfert), the journal grouped day by day (same
 * collapsible pattern as the Livre de recettes), and — for the till
 * operator/admin only — a manual balance verification. The detailed
 * "Rapport" (revenue by method/category/VAT + cash reconciliation) lives on
 * its own page (CaisseRapportClient) — this page just links to it, since the
 * combined journal+report page had grown too long to scan at a glance.
 * Replaces the old caisse / caisse/[sessionId] / caisse/[sessionId]/rapport /
 * caisse/depots four-page flow.
 */
export function CaisseClient({
  ledger,
  ledgerError,
  currentSession,
  suggestedOpeningFloat,
  canVerify = false,
  salonName,
  logoUrl,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openingFloat, setOpeningFloat] = useState(() => (suggestedOpeningFloat != null ? String(suggestedOpeningFloat) : ""));
  const [movementType, setMovementType] = useState("EXPENSE");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementLabel, setMovementLabel] = useState("");
  const [expandedDays, setExpandedDays] = useState(() => new Set());
  const [verifySessionId, setVerifySessionId] = useState(currentSession?.id ?? ledger?.sessions?.at(-1)?.id ?? "");
  const [verifyAmount, setVerifyAmount] = useState("");
  const [verifyNote, setVerifyNote] = useState("");
  const [showDenominationCounter, setShowDenominationCounter] = useState(false);

  const dayGroups = useMemo(() => (ledger?.rows ? groupLedgerRowsByDay(ledger.rows) : []), [ledger?.rows]);

  const finalBalance = ledger?.totals?.finalBalance ?? currentSession?.expectedCash ?? null;
  const isZero = finalBalance != null && Math.abs(finalBalance) < 0.005;

  const reportQuery = ledger?.filters ? new URLSearchParams({ from: ledger.filters.from, to: ledger.filters.to }).toString() : "";

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
    if (!movementLabel.trim()) return toast.error("Indiquez un motif.");
    startTransition(async () => {
      const result = await recordCashMovement({ type: movementType, amount: value, label: movementLabel.trim() });
      if (!result.success) return toast.error(result.message);
      toast.success(`${result.data.pieceNumber} enregistré.`);
      setMovementAmount("");
      setMovementLabel("");
      router.refresh();
    });
  }

  function handleVerify(event) {
    event.preventDefault();
    if (!verifySessionId) return toast.error("Sélectionnez une session à vérifier.");
    const amount = Number(verifyAmount);
    if (!Number.isFinite(amount) || amount < 0) return toast.error("Indiquez le montant compté.");
    startTransition(async () => {
      const result = await verifyCashSessionBalance({ sessionId: verifySessionId, countedAmount: amount, note: verifyNote });
      if (!result.success) return toast.error(result.message);
      toast.success(
        result.data.verifiedVariance === 0
          ? "Vérification enregistrée — aucun écart."
          : `Vérification enregistrée — écart de ${formatEuro(result.data.verifiedVariance)}.`
      );
      setVerifyAmount("");
      setVerifyNote("");
      setShowDenominationCounter(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 print:space-y-4">
      <style>{`
        @media print {
          @page {
            @bottom-right { content: "Page " counter(page) " sur " counter(pages); font-size: 9px; }
          }
        }
      `}</style>

      <div className="hidden print:block">
        <CaissePrintHeader salonName={salonName} logoUrl={logoUrl} from={ledger?.filters?.from} to={ledger?.filters?.to} />
      </div>

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
          <Link
            href={`/dashboard/boutique/caisse/rapport${reportQuery ? `?${reportQuery}` : ""}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stroke px-3 py-2 text-sm font-medium text-gray-600 hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
          >
            <BarChart3 size={14} />
            Rapport
            <ArrowRight size={14} />
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1 rounded-lg border border-stroke px-3 py-2 text-sm font-medium text-gray-600 hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
          >
            <Printer size={14} />
            Imprimer
          </button>
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
            <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="movement-label">Motif</label>
            <input
              id="movement-label"
              type="text"
              value={movementLabel}
              onChange={(event) => setMovementLabel(event.target.value)}
              placeholder={MOVEMENT_TYPES.find((t) => t.value === movementType)?.hint}
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
            <StatCard icon={<ArrowUpCircle size={20} />} label="Total entrées" value={formatEuro(ledger.totals.entrees)} />
            <StatCard icon={<ArrowDownCircle size={20} />} label="Total sorties" value={formatEuro(ledger.totals.sorties)} />
            <StatCard icon={<Wallet size={20} />} label="Solde" value={formatEuro(ledger.totals.finalBalance)} />
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
                    <TableHead className="text-right">Solde</TableHead>
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

      {canVerify && ledger?.sessions?.length > 0 && (
        <div className="rounded-[10px] border border-stroke bg-white p-5 shadow-1 print:hidden dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardCheck size={18} className="text-[#2f3a2e]" />
            <h2 className="font-semibold text-gray-900 dark:text-white">Vérifier le solde</h2>
          </div>
          <p className="mb-3 text-xs text-gray-500 dark:text-dark-6">
            Recompte réel d'une session — utile car la clôture automatique de minuit suppose un écart nul, faute de
            comptage physique. N'écrase pas la clôture, s'enregistre à côté.
          </p>
          <form onSubmit={handleVerify} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="verify-session">Session</label>
              <select
                id="verify-session"
                value={verifySessionId}
                onChange={(event) => setVerifySessionId(event.target.value)}
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              >
                {ledger.sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDateTime(s.openedAt)} {s.closedAt ? "" : "(en cours)"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="verify-amount">Montant compté</label>
              <input
                id="verify-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={verifyAmount}
                onChange={(event) => setVerifyAmount(event.target.value)}
                placeholder="0.00"
                className="h-10 w-32 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              />
            </div>
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="verify-note">Note (optionnel)</label>
              <input
                id="verify-note"
                type="text"
                value={verifyNote}
                onChange={(event) => setVerifyNote(event.target.value)}
                maxLength={1000}
                className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowDenominationCounter((v) => !v)}
              className="inline-flex h-10 items-center gap-1 rounded-lg border border-stroke px-3 text-sm font-medium text-gray-600 hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
            >
              <Calculator size={14} />
              {showDenominationCounter ? "Masquer le comptage" : "Compter par dénomination"}
            </button>
            <Button type="submit" disabled={isPending}>
              <ClipboardCheck size={16} />
              Enregistrer la vérification
            </Button>
          </form>
          {showDenominationCounter && (
            <div className="mt-3 border-t border-gray-100 pt-3 dark:border-dark-3">
              <DenominationCounter onTotalChange={(total) => setVerifyAmount(String(total))} />
            </div>
          )}
        </div>
      )}
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
          return (
            <TableRow key={rowKey}>
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
              <TableCell className={ROW_STYLES[row.kind] ?? ""}>{row.label}</TableCell>
              <TableCell className="text-right tabular-nums">{row.entree ? formatEuro(row.entree) : "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{row.sortie ? formatEuro(row.sortie) : "—"}</TableCell>
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

function StatCard({ icon, label, value }) {
  return (
    <div className="flex items-center gap-4 rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card print:gap-2 print:p-2 print:shadow-none">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white print:hidden">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-dark dark:text-white print:text-base">{value}</p>
        <p className="truncate text-sm text-gray-500 dark:text-dark-6">{label}</p>
      </div>
    </div>
  );
}
