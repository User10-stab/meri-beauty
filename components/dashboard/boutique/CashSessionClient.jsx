"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Wallet, Lock, LockOpen, History, BookOpen, Landmark, Calculator } from "lucide-react";
import { toast } from "sonner";
import Button from "@/components/ui/Button";
import { openCashSession, closeCashSession, listCashSessions } from "@/actions/dashboard/cash-sessions";
import { CashMovementPanel } from "@/components/dashboard/boutique/CashMovementPanel";
import { DenominationCounter } from "@/components/dashboard/boutique/DenominationCounter";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });
}

// The most recently closed session's countedCash — what the drawer actually
// held at the last close, which is what the next morning's float should
// start from. `history` is ordered openedAt desc, and includes the
// currently open session (if any) at index 0, so the first CLOSED entry is
// the one that matters here.
function lastCountedCash(current, history) {
  if (current) return "";
  const lastClosed = history.find((s) => s.closedAt && s.countedCash != null);
  return lastClosed ? String(lastClosed.countedCash) : "";
}

function StatCard({ icon, label, value }) {
  return (
    <div className="flex items-center gap-4 rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-dark dark:text-white">{value}</p>
        <p className="truncate text-sm text-gray-500 dark:text-dark-6">{label}</p>
      </div>
    </div>
  );
}

export function CashSessionClient({ initialCurrent, initialHistory, initialSummary = null, initialMovements = [] }) {
  const [current, setCurrent] = useState(initialCurrent);
  const [history, setHistory] = useState(initialHistory);
  const [summary, setSummary] = useState(initialSummary);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Report automatique: pre-filled with the previous session's own counted
  // total, same as the physical ledger in the example (each day's opening
  // balance is the prior day's closing one) — still a plain editable
  // number, not a computed/locked value, since a real morning float can
  // legitimately differ (a bill kept aside, a correction).
  const [openingFloat, setOpeningFloat] = useState(() => lastCountedCash(initialCurrent, initialHistory));
  const [countedCash, setCountedCash] = useState("");
  const [showDenominationCounter, setShowDenominationCounter] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Always re-reads with the filters currently on screen, so opening or
  // closing a till does not silently drop the user back to the full history.
  async function refreshHistory(range = { from, to }) {
    const result = await listCashSessions({ pageSize: 20, from: range.from || null, to: range.to || null });
    if (!result.success) return toast.error(result.message);
    setHistory(result.data);
    setSummary(result.summary);
  }

  function handleOpen() {
    const amount = Number(openingFloat);
    if (!Number.isFinite(amount) || amount < 0) return toast.error("Indiquez un fond de caisse valide.");
    startTransition(async () => {
      const result = await openCashSession(amount);
      if (!result.success) return toast.error(result.message);
      setCurrent(result.data);
      setOpeningFloat("");
      toast.success("Caisse ouverte.");
      refreshHistory();
    });
  }

  function handleClose() {
    if (!current) return;
    const amount = Number(countedCash);
    if (!Number.isFinite(amount) || amount < 0) return toast.error("Indiquez le montant compté.");
    startTransition(async () => {
      const result = await closeCashSession(current.id, amount);
      if (!result.success) return toast.error(result.message);
      setCurrent(null);
      setCountedCash("");
      setShowDenominationCounter(false);
      // Carried forward from this exact response rather than waiting on
      // refreshHistory's round trip — the next float is already known the
      // instant the close succeeds.
      setOpeningFloat(String(result.data.countedCash));
      toast.success(
        result.data.variance === 0
          ? "Caisse clôturée — aucun écart."
          : `Caisse clôturée — écart de ${formatEuro(result.data.variance)}.`
      );
      refreshHistory();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-dark dark:text-white">Clôture de caisse</h1>
          <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
            Ouvrez la caisse en début de journée avec le fond de caisse, clôturez-la en fin de service avec le comptage réel.
          </p>
        </div>
        <Link
          href="/dashboard/boutique/caisse/depots"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#2f3a2e] hover:underline dark:text-white"
        >
          <Landmark size={14} />
          Dépôts bancaires
        </Link>
      </div>

      <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        {!current ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <LockOpen size={18} className="text-[#2f3a2e]" />
              <h2 className="font-semibold text-gray-900 dark:text-white">Aucune session ouverte</h2>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="opening-float">Fond de caisse</label>
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
                {openingFloat !== "" && (
                  <p className="mt-1 text-xs text-gray-400">Repris du dernier comptage — modifiable.</p>
                )}
              </div>
              <Button onClick={handleOpen} disabled={isPending}>
                <Wallet size={16} />
                Ouvrir la caisse
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Lock size={18} className="text-[#2f3a2e]" />
                <h2 className="font-semibold text-gray-900 dark:text-white">Session ouverte</h2>
              </div>
              <Link
                href={`/dashboard/boutique/caisse/${current.id}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-[#2f3a2e] hover:underline dark:text-white"
              >
                <BookOpen size={14} />
                Livre de caisse
              </Link>
            </div>
            <p className="text-sm text-gray-500 dark:text-dark-6">
              Ouverte le {formatDateTime(current.openedAt)} par {current.openedBy?.fullName ?? "—"} — fond de caisse {formatEuro(current.openingFloat)}.
            </p>
            <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4 dark:border-dark-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="counted-cash">Montant compté en caisse</label>
                <input
                  id="counted-cash"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={countedCash}
                  onChange={(event) => setCountedCash(event.target.value)}
                  placeholder="0.00"
                  className="h-10 w-40 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
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
              <Button onClick={handleClose} disabled={isPending}>
                <Lock size={16} />
                Clôturer la caisse
              </Button>
            </div>
            {showDenominationCounter && (
              <div className="border-t border-gray-100 pt-4 dark:border-dark-3">
                <DenominationCounter onTotalChange={(total) => setCountedCash(String(total))} />
              </div>
            )}
          </div>
        )}
      </div>

      {current && <CashMovementPanel initialMovements={initialMovements} />}

      <div>
        <div className="mb-3 flex items-center gap-2">
          <History size={18} className="text-[#2f3a2e]" />
          <h2 className="font-semibold text-gray-900 dark:text-white">Historique</h2>
        </div>
        {/* Windowed on openedAt: a till session is a day's work, so "when was
            it opened" is what anyone reconciling a month actually means. */}
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <div>
            <label htmlFor="cash-from" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6">
              Du
            </label>
            <input
              id="cash-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
          <div>
            <label htmlFor="cash-to" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6">
              Au
            </label>
            <input
              id="cash-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
          <button
            type="button"
            onClick={() => refreshHistory({ from, to })}
            className="rounded-[7px] bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-opacity-90"
          >
            Filtrer
          </button>
          {(from || to) && (
            <button
              type="button"
              onClick={() => {
                setFrom("");
                setTo("");
                refreshHistory({ from: "", to: "" });
              }}
              className="rounded-[7px] border border-stroke px-4 py-2 text-sm font-semibold text-gray-500 hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
            >
              Réinitialiser
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 px-5 py-10 text-center text-sm text-gray-500">
            {from || to ? "Aucune session sur cette période." : "Aucune session clôturée pour l’instant."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {history.some((s) => s.closedAt) && (
              <StatCard
                icon={<Wallet size={20} />}
                label="Dernier écart"
                value={formatEuro(history.find((s) => s.closedAt)?.variance ?? 0)}
              />
            )}
            {/* Totals span the whole filtered range, not just this page — a
                total that moved when you paged would be worse than none. Open
                sessions are excluded: their expected/counted are still null. */}
            {summary?.closedCount > 0 && (
              <>
                <StatCard icon={<Wallet size={20} />} label={`Sessions clôturées`} value={summary.closedCount} />
                <StatCard icon={<Wallet size={20} />} label="Espèces comptées" value={formatEuro(summary.countedCash)} />
                <StatCard
                  icon={<Wallet size={20} />}
                  label="Écart cumulé"
                  value={formatEuro(summary.variance)}
                />
              </>
            )}
          </div>
        )}
        {history.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stroke text-xs uppercase text-gray-400 dark:border-dark-3">
                <tr>
                  <th className="px-4 py-3">Ouverte</th>
                  <th className="px-4 py-3">Par</th>
                  <th className="px-4 py-3">Fond</th>
                  <th className="px-4 py-3">Clôturée</th>
                  <th className="px-4 py-3">Attendu</th>
                  <th className="px-4 py-3">Compté</th>
                  <th className="px-4 py-3">Écart</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-dark-3">
                {history.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(s.openedAt)}</td>
                    <td className="px-4 py-3">{s.openedBy?.fullName ?? "—"}</td>
                    <td className="px-4 py-3">{formatEuro(s.openingFloat)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{s.closedAt ? formatDateTime(s.closedAt) : "En cours"}</td>
                    <td className="px-4 py-3">{s.expectedCash == null ? "—" : formatEuro(s.expectedCash)}</td>
                    <td className="px-4 py-3">{s.countedCash == null ? "—" : formatEuro(s.countedCash)}</td>
                    <td className={`px-4 py-3 font-medium ${s.variance == null ? "" : s.variance === 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {s.variance == null ? "—" : formatEuro(s.variance)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Link
                        href={`/dashboard/boutique/caisse/${s.id}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-[#2f3a2e] hover:underline dark:text-white"
                      >
                        <BookOpen size={14} />
                        Livre
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
