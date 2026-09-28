"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { History, ShoppingBag, CalendarHeart, Palette, GraduationCap } from "lucide-react";
import { PROMO_CODE_SCOPES, PROMO_CODE_SCOPE_LABELS } from "@/lib/promo-code-scopes";
import { formatDateTime, formatEuro } from "./promo-format";

const SCOPE_ICON = { BOUTIQUE: ShoppingBag, APPOINTMENT: CalendarHeart, WORKSHOP: Palette, FORMATION: GraduationCap };

const STATUS_LABELS = {
  PENDING_PAYMENT: "Paiement en attente",
  PENDING_PICKUP: "À retirer",
  PAID: "Payée",
  PROCESSING: "En préparation",
  READY_FOR_PICKUP: "Prête",
  SHIPPED: "Expédiée",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  EXPIRED: "Expirée",
  SETTLED_AT_COUNTER: "Encaissée en caisse",
  PENDING_DEPOSIT: "Acompte en attente",
  CONFIRMED: "Confirmée",
  NO_SHOW: "Absente",
  PENDING: "En attente",
  PARTIALLY_PAID: "Acompte payé",
  REFUNDED: "Remboursé",
  PARTIALLY_REFUNDED: "Remboursé en partie",
  FAILED: "Paiement abandonné",
  REFUND_PENDING: "Remboursement en cours",
  REFUND_FAILED: "Remboursement en échec",
};

/**
 * Who used the code, where, for how much. Released rows (cancelled, expired
 * hold, abandoned payment) stay listed but greyed — they no longer count
 * toward the per-customer limit.
 */
export function PromoUsageHistory({ usage }) {
  const [scope, setScope] = useState("ALL");

  const counted = useMemo(() => usage.filter((u) => !u.released), [usage]);
  const stats = useMemo(
    () => ({
      uses: counted.length,
      discount: counted.reduce((s, u) => s + u.discount, 0),
      revenue: counted.reduce((s, u) => s + u.total, 0),
      customers: new Set(counted.map((u) => u.customer?.id).filter(Boolean)).size,
    }),
    [counted]
  );
  const rows = scope === "ALL" ? usage : usage.filter((u) => u.scope === scope);
  const presentScopes = PROMO_CODE_SCOPES.filter((s) => usage.some((u) => u.scope === s));

  return (
    <section className="rounded-2xl border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark">
      <div className="flex flex-col gap-3 border-b border-stroke px-5 py-4 dark:border-dark-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fdf8f0] text-[#b89664] dark:bg-white/5">
            <History size={16} />
          </span>
          <div>
            <h2 className="text-base font-semibold text-dark dark:text-white">Historique d&apos;utilisation</h2>
            <p className="text-xs text-gray-500 dark:text-dark-6">Chaque commande ou réservation passée avec ce code.</p>
          </div>
        </div>
        {presentScopes.length > 1 && (
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          >
            <option value="ALL">Tout</option>
            {presentScopes.map((s) => (
              <option key={s} value={s}>{PROMO_CODE_SCOPE_LABELS[s]}</option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-stroke border-b border-stroke dark:divide-dark-3 dark:border-dark-3 lg:grid-cols-4 lg:divide-y-0">
        <Stat label="Utilisations comptées" value={stats.uses} />
        <Stat label="Clientes différentes" value={stats.customers} />
        <Stat label="Remise accordée" value={formatEuro(stats.discount)} />
        <Stat label="Montant encaissé / dû" value={formatEuro(stats.revenue)} />
      </div>

      {rows.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-gray-500">Ce code n&apos;a encore jamais été utilisé.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                <th className="px-6 py-3">Date</th>
                <th className="px-3 py-3">Cliente</th>
                <th className="px-3 py-3">Achat</th>
                <th className="px-3 py-3">Statut</th>
                <th className="px-3 py-3 text-right">Remise</th>
                <th className="px-6 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke dark:divide-dark-3">
              {rows.map((u) => {
                const Icon = SCOPE_ICON[u.scope];
                return (
                  <tr key={u.id} className={u.released ? "text-gray-400" : "text-gray-700 dark:text-dark-6"}>
                    <td className="whitespace-nowrap px-6 py-3">{formatDateTime(u.createdAt)}</td>
                    <td className="px-3 py-3">
                      <span className={`block font-medium ${u.released ? "" : "text-dark dark:text-white"}`}>{u.customer?.fullName ?? "—"}</span>
                      <span className="block text-xs text-gray-400">{u.customer?.email}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon size={14} className="shrink-0 text-[#b89664]" />
                        {u.href ? (
                          <Link href={u.href} className="hover:underline">{u.label}</Link>
                        ) : (
                          u.label
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${u.released ? "bg-gray-100 dark:bg-dark-2" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"}`}>
                        {STATUS_LABELS[u.status] ?? u.status}
                      </span>
                      {u.released && <span className="ml-1.5 text-[11px]">· non comptée</span>}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-3 text-right font-semibold ${u.released ? "" : "text-[#8a6d3b]"}`}>-{formatEuro(u.discount)}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-right">{formatEuro(u.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="px-5 py-4 sm:px-6">
      <p className="text-lg font-bold text-dark dark:text-white">{value}</p>
      <p className="text-xs text-gray-500 dark:text-dark-6">{label}</p>
    </div>
  );
}
