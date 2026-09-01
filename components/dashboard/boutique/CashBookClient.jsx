"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, FileText } from "lucide-react";
import { getCashBookLedger } from "@/actions/dashboard/cash-book";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Brussels" });
}

const ROW_STYLES = {
  OPENING: "font-semibold text-gray-900 dark:text-white",
  REFUND: "text-red-600",
  EXPENSE: "text-red-600",
  WITHDRAWAL: "text-red-600",
};

export function CashBookClient({ ledger: initialLedger }) {
  const [ledger, setLedger] = useState(initialLedger);
  const { session, rows, totals } = ledger;

  // A closed session's ledger is a frozen historical record — nothing to
  // poll for. An open one changes every time a sale lands anywhere (POS,
  // Pointage & encaissement) while a cashier may be sitting on this exact
  // page watching it, so it re-reads itself rather than requiring a manual
  // reload to see a sale that just happened elsewhere.
  useEffect(() => {
    if (session.closedAt) return;
    let cancelled = false;
    const interval = setInterval(() => {
      getCashBookLedger(session.id).then((result) => {
        if (!cancelled && result.success) setLedger(result.data);
      }).catch(() => {});
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session.id, session.closedAt]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/dashboard/boutique/caisse"
          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-gray-500 hover:text-primary dark:text-dark-6"
        >
          <ArrowLeft size={14} />
          Retour à la caisse
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-[#2f3a2e]" />
            <h1 className="text-2xl font-bold text-dark dark:text-white">Livre de caisse</h1>
          </div>
          <Link
            href={`/dashboard/boutique/caisse/${session.id}/rapport`}
            className="inline-flex items-center gap-1 text-sm font-medium text-[#2f3a2e] hover:underline dark:text-white"
          >
            <FileText size={14} />
            Rapport {session.closedAt ? "Z" : "X"}
          </Link>
        </div>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Session ouverte le {formatDateTime(session.openedAt)}
          {session.closedAt ? ` — clôturée le ${formatDateTime(session.closedAt)}` : " — en cours"}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <p className="text-xl font-bold text-dark dark:text-white">{formatEuro(totals.entrees)}</p>
          <p className="text-sm text-gray-500 dark:text-dark-6">Total entrées</p>
        </div>
        <div className="rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <p className="text-xl font-bold text-dark dark:text-white">{formatEuro(totals.sorties)}</p>
          <p className="text-sm text-gray-500 dark:text-dark-6">Total sorties</p>
        </div>
        <div className="rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <p className="text-xl font-bold text-dark dark:text-white">{formatEuro(totals.finalBalance)}</p>
          <p className="text-sm text-gray-500 dark:text-dark-6">Solde {session.closedAt ? "final" : "actuel"}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stroke text-xs uppercase text-gray-400 dark:border-dark-3">
            <tr>
              <th className="whitespace-nowrap px-4 py-3">Date</th>
              <th className="whitespace-nowrap px-4 py-3">N° pièce</th>
              <th className="whitespace-nowrap px-4 py-3">Réf.</th>
              <th className="px-4 py-3">Désignation</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Entrées (€)</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Sorties (€)</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Solde (€)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-dark-3">
            {rows.map((row, index) => (
              <tr key={`${row.kind}-${row.pieceNumber ?? index}-${row.date}`}>
                <td className="whitespace-nowrap px-4 py-3">{formatDateTime(row.date)}</td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{row.pieceNumber ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{row.reference ?? "—"}</td>
                <td className={`px-4 py-3 ${ROW_STYLES[row.kind] ?? ""}`}>{row.label}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{row.entree ? formatEuro(row.entree) : "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{row.sortie ? formatEuro(row.sortie) : "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-gray-900 dark:text-white">
                  {formatEuro(row.solde)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
