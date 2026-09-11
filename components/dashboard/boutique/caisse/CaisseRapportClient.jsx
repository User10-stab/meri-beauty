"use client";

import Link from "next/link";
import { ArrowLeft, Printer, Euro, Banknote, CreditCard, Globe, Wallet } from "lucide-react";
import { CaisseFilterBar } from "@/components/dashboard/boutique/caisse/CaisseFilterBar";
import { CaissePrintHeader } from "@/components/dashboard/boutique/caisse/CaissePrintHeader";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value ?? 0);
}

const METHOD_LABELS = { CASH: "Espèces", CARD: "Carte", ONLINE: "En ligne" };
const METHOD_ICONS = { CASH: <Banknote size={20} />, CARD: <CreditCard size={20} />, ONLINE: <Globe size={20} /> };

/**
 * The Livre de caisse's "Rapport" — every payment method's revenue plus the
 * cash reconciliation, over the same date range — as its own page rather
 * than an inline collapsible section. Moved out of CaisseClient.jsx because
 * the combined journal+report page had grown too long to scan at a glance;
 * this page mirrors the Livre de recettes' visual language (icon stat cards,
 * same filter bar) for consistency, reached from the main Livre de caisse
 * page via a plain link that carries the current date range along.
 */
export function CaisseRapportClient({ report, filters, salonName, logoUrl }) {
  const methodTotal = report ? Object.values(report.byMethod).reduce((sum, v) => sum + v, 0) : 0;
  const categoryTotal = report ? Object.values(report.byCategory).reduce((sum, v) => sum + v, 0) : 0;
  const methodCard = (method) => report?.byMethod?.[method] ?? 0;

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
        <CaissePrintHeader salonName={salonName} logoUrl={logoUrl} from={filters?.from} to={filters?.to} />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <Link
            href="/dashboard/boutique/caisse"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-primary dark:text-dark-6"
          >
            <ArrowLeft size={14} />
            Retour au livre de caisse
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-2xl font-bold text-dark dark:text-white">Rapport</h1>
            {report && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  report.isFinal
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                    : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                }`}
              >
                {report.isFinal ? "Définitif" : "Provisoire"}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
            Recettes tous moyens de paiement et réconciliation espèces, sur la période sélectionnée.
          </p>
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

      <div className="print:hidden">
        <CaisseFilterBar filters={filters} basePath="/dashboard/boutique/caisse/rapport" />
      </div>

      {!report ? (
        <p className="px-2 py-10 text-center text-sm text-gray-400">Aucune donnée sur cette période.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4 print:gap-2">
            <StatCard icon={<Euro size={20} />} label="Total" value={formatEuro(methodTotal)} />
            {["CASH", "CARD", "ONLINE"].map((method) => (
              <StatCard key={method} icon={METHOD_ICONS[method]} label={METHOD_LABELS[method]} value={formatEuro(methodCard(method))} />
            ))}
          </div>

          <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card print:border-0 print:shadow-none">
            <div className="space-y-4 p-5 print:px-0">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Par mode de paiement</h3>
                  <div className="divide-y divide-gray-100 dark:divide-dark-3">
                    {Object.entries(report.byMethod).map(([method, amount]) => (
                      <SummaryRow key={method} label={METHOD_LABELS[method] ?? method} value={amount} />
                    ))}
                  </div>
                  <div className="mt-2 border-t border-gray-200 pt-2 dark:border-dark-3">
                    <SummaryRow label="Total" value={methodTotal} emphasis />
                  </div>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Par catégorie</h3>
                  <div className="divide-y divide-gray-100 dark:divide-dark-3">
                    {Object.entries(report.byCategory).map(([category, amount]) => (
                      <SummaryRow key={category} label={category} value={amount} />
                    ))}
                  </div>
                  <div className="mt-2 border-t border-gray-200 pt-2 dark:border-dark-3">
                    <SummaryRow label="Total" value={categoryTotal} emphasis />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">TVA</h3>
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
                      {report.byVatRate.map((row) => (
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

              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                  <Wallet size={15} />
                  Réconciliation caisse (espèces)
                </h3>
                <div className="divide-y divide-gray-100 dark:divide-dark-3">
                  <SummaryRow label="Mouvements — apports" value={report.cashMovements.in} />
                  <SummaryRow label="Mouvements — sorties" value={-report.cashMovements.out} />
                  {report.expectedCash != null && <SummaryRow label="Attendu en caisse" value={report.expectedCash} emphasis />}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryRow({ label, value, emphasis = false }) {
  return (
    <div className={`flex items-center justify-between py-1.5 text-sm ${emphasis ? "font-semibold text-gray-900 dark:text-white" : "text-gray-600 dark:text-dark-6"}`}>
      <span>{label}</span>
      <span>{formatEuro(value)}</span>
    </div>
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
