"use client";

import Link from "next/link";
import { ArrowLeft, FileText, Printer } from "lucide-react";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Brussels" });
}

const METHOD_LABELS = { CASH: "Espèces", CARD: "Carte", ONLINE: "En ligne" };

function SummaryRow({ label, value, emphasis = false }) {
  return (
    <div className={`flex items-center justify-between py-1.5 text-sm ${emphasis ? "font-semibold text-gray-900 dark:text-white" : "text-gray-600 dark:text-dark-6"}`}>
      <span>{label}</span>
      <span>{formatEuro(value)}</span>
    </div>
  );
}

/**
 * The end-of-day report: an "X" while the till is still open (a snapshot,
 * regenerated fresh every time this page loads) or a "Z" once it's closed —
 * and a closed session's figures can never change again (closeCashSession
 * only ever acts on an open one, and nothing reopens one), so the Z badge
 * alone is already the guarantee that this exact report is final.
 */
export function DayReportClient({ report, sessionId }) {
  const { session, isFinal, byMethod, byCategory, byVatRate, cashMovements, expectedCash } = report;

  const methodTotal = Object.values(byMethod).reduce((sum, v) => sum + v, 0);
  const categoryTotal = Object.values(byCategory).reduce((sum, v) => sum + v, 0);

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <Link
            href={`/dashboard/boutique/caisse/${sessionId}`}
            className="inline-flex w-fit items-center gap-1 text-sm font-medium text-gray-500 hover:text-primary dark:text-dark-6"
          >
            <ArrowLeft size={14} />
            Retour au livre de caisse
          </Link>
          <div className="flex items-center gap-2">
            <FileText size={20} className="text-[#2f3a2e]" />
            <h1 className="text-2xl font-bold text-dark dark:text-white">
              Rapport {isFinal ? "Z" : "X"}
            </h1>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                isFinal
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
              }`}
            >
              {isFinal ? "Clôturé — définitif" : "Session en cours — provisoire"}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1 rounded-lg border border-stroke px-3 py-2 text-sm font-medium text-gray-600 hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
        >
          <Printer size={14} />
          Imprimer
        </button>
      </div>

      <p className="text-sm text-gray-500 dark:text-dark-6 print:text-black">
        Session ouverte le {formatDateTime(session.openedAt)}
        {session.closedAt ? ` — clôturée le ${formatDateTime(session.closedAt)}` : " — toujours en cours"}.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <h2 className="mb-3 font-semibold text-gray-900 dark:text-white">Par mode de paiement</h2>
          <div className="divide-y divide-gray-100 dark:divide-dark-3">
            {Object.entries(byMethod).map(([method, amount]) => (
              <SummaryRow key={method} label={METHOD_LABELS[method] ?? method} value={amount} />
            ))}
          </div>
          <div className="mt-2 border-t border-gray-200 pt-2 dark:border-dark-3">
            <SummaryRow label="Total" value={methodTotal} emphasis />
          </div>
        </div>

        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <h2 className="mb-3 font-semibold text-gray-900 dark:text-white">Par catégorie</h2>
          <div className="divide-y divide-gray-100 dark:divide-dark-3">
            {Object.entries(byCategory).map(([category, amount]) => (
              <SummaryRow key={category} label={category} value={amount} />
            ))}
          </div>
          <div className="mt-2 border-t border-gray-200 pt-2 dark:border-dark-3">
            <SummaryRow label="Total" value={categoryTotal} emphasis />
          </div>
        </div>
      </div>

      <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <h2 className="mb-3 font-semibold text-gray-900 dark:text-white">TVA</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stroke text-xs uppercase text-gray-400 dark:border-dark-3">
              <tr>
                <th className="py-2 pr-4">Taux</th>
                <th className="py-2 pr-4 text-right">Base HT</th>
                <th className="py-2 pr-4 text-right">TVA</th>
                <th className="py-2 pr-4 text-right">Total TTC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-dark-3">
              {byVatRate.map((row) => (
                <tr key={row.rate ?? "unknown"}>
                  <td className="py-2 pr-4">{row.rate == null ? "Non déterminé" : `${row.rate}%`}</td>
                  <td className="py-2 pr-4 text-right">{formatEuro(row.netAmount)}</td>
                  <td className="py-2 pr-4 text-right">{formatEuro(row.vatAmount)}</td>
                  <td className="py-2 pr-4 text-right font-medium">{formatEuro(row.grossAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <h2 className="mb-3 font-semibold text-gray-900 dark:text-white">Réconciliation caisse (espèces)</h2>
        <div className="divide-y divide-gray-100 dark:divide-dark-3">
          <SummaryRow label="Fond d'ouverture" value={session.openingFloat} />
          <SummaryRow label="Mouvements — apports" value={cashMovements.in} />
          <SummaryRow label="Mouvements — sorties" value={-cashMovements.out} />
          <SummaryRow label="Attendu en caisse" value={expectedCash} emphasis />
          {session.countedCash != null && <SummaryRow label="Compté à la clôture" value={session.countedCash} />}
          {session.variance != null && (
            <div
              className={`flex items-center justify-between py-1.5 text-sm font-semibold ${
                session.variance === 0 ? "text-emerald-600" : "text-red-600"
              }`}
            >
              <span>Écart</span>
              <span>{formatEuro(session.variance)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
