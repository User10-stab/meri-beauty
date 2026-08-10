"use client";

import { Euro, UserPlus, TicketPercent, PackageX } from "lucide-react";

const SOURCE_COLORS = {
  boutique: "#2f3a2e",
  appointments: "#b89664",
  workshops: "#0ea5e9",
  formations: "#8b5cf6",
};

const SOURCE_LABELS = {
  boutique: "Boutique",
  appointments: "Rendez-vous",
  workshops: "Ateliers",
  formations: "Formations",
};

const ORDER_STATUS_LABEL = {
  PENDING_PAYMENT: "En attente de paiement",
  PENDING_PICKUP: "En attente de retrait",
  PROCESSING: "En traitement",
  PAID: "Payée",
  READY_FOR_PICKUP: "Prête pour retrait",
  SHIPPED: "Expédiée",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  EXPIRED: "Expirée",
};

const APPOINTMENT_STATUS_LABEL = {
  PENDING: "En attente",
  CONFIRMED: "Confirmé",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
  NO_SHOW: "Absence",
};

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

export function ReportsPageClient({ data }) {
  const maxMonthTotal = Math.max(
    1,
    ...data.revenueByMonth.map((m) => m.boutique + m.appointments + m.workshops + m.formations),
  );
  const maxSourceValue = Math.max(1, ...data.revenueBySource.map((s) => s.value));
  const maxProductQty = Math.max(1, ...data.topProducts.map((p) => p.quantity));
  const maxCustomerCount = Math.max(1, ...data.newCustomersByMonth.map((m) => m.count));

  return (
    <div className="space-y-6">
      {/* ── Summary cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Euro size={20} />} label="Chiffre d'affaires (6 mois)" value={formatEuro(data.totalRevenue)} />
        <StatCard icon={<UserPlus size={20} />} label="Nouveaux clients (6 mois)" value={data.totalNewCustomers} />
        <StatCard
          icon={<TicketPercent size={20} />}
          label="Codes promo utilisés"
          value={`${data.promoCode.uses} · ${formatEuro(data.promoCode.totalDiscount)}`}
        />
        <StatCard icon={<PackageX size={20} />} label="Retours (6 mois)" value={data.returnsCount} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* ── Revenue by month, stacked by source ─────────────────────────── */}
        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card xl:col-span-2">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-dark dark:text-white">Chiffre d'affaires par mois</h2>
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-dark-6">
              {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                <span key={key} className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS[key] }} />
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="flex h-56 gap-3">
            {data.revenueByMonth.map((m) => {
              const total = m.boutique + m.appointments + m.workshops + m.formations;
              const heightPct = Math.max(total > 0 ? 2 : 0, (total / maxMonthTotal) * 100);
              return (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-xs font-medium text-gray-500 dark:text-dark-6">
                    {total > 0 ? formatEuro(total) : ""}
                  </span>
                  <div className="flex w-full flex-1 items-end">
                    <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-md" style={{ height: `${heightPct}%` }}>
                      {["boutique", "appointments", "workshops", "formations"].map((key) =>
                        m[key] > 0 ? (
                          <div
                            key={key}
                            style={{
                              backgroundColor: SOURCE_COLORS[key],
                              height: total > 0 ? `${(m[key] / total) * 100}%` : 0,
                            }}
                          />
                        ) : null,
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400">{m.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Revenue by source, totals ────────────────────────────────────── */}
        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <h2 className="mb-4 text-lg font-bold text-dark dark:text-white">Répartition par activité</h2>
          <ul className="space-y-4">
            {data.revenueBySource.map((s) => (
              <li key={s.label}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="font-medium text-dark dark:text-white">{s.label}</span>
                  <span className="text-gray-500 dark:text-dark-6">{formatEuro(s.value)}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-dark-3">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(s.value / maxSourceValue) * 100}%`,
                      backgroundColor: SOURCE_COLORS[Object.keys(SOURCE_LABELS).find((k) => SOURCE_LABELS[k] === s.label)],
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* ── Top products ─────────────────────────────────────────────────── */}
        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <h2 className="mb-4 text-lg font-bold text-dark dark:text-white">Meilleures ventes (produits)</h2>
          {data.topProducts.length === 0 ? (
            <p className="text-sm text-gray-400">Aucune vente sur la période.</p>
          ) : (
            <ul className="space-y-3">
              {data.topProducts.map((p) => (
                <li key={p.name}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="truncate font-medium text-dark dark:text-white">{p.name}</span>
                    <span className="ml-2 shrink-0 text-gray-500 dark:text-dark-6">{p.quantity} vendu{p.quantity > 1 ? "s" : ""}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-dark-3">
                    <div className="h-full rounded-full bg-[#2f3a2e] dark:bg-white" style={{ width: `${(p.quantity / maxProductQty) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── New customers per month ──────────────────────────────────────── */}
        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <h2 className="mb-4 text-lg font-bold text-dark dark:text-white">Nouveaux clients</h2>
          <div className="flex h-36 gap-2">
            {data.newCustomersByMonth.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-xs font-medium text-gray-500 dark:text-dark-6">{m.count > 0 ? m.count : ""}</span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t-md bg-[#b89664]"
                    style={{ height: `${Math.max(m.count > 0 ? 4 : 0, (m.count / maxCustomerCount) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400">{m.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Order status breakdown ──────────────────────────────────────── */}
        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <h2 className="mb-4 text-lg font-bold text-dark dark:text-white">Statuts des commandes</h2>
          {data.orderStatusCounts.length === 0 ? (
            <p className="text-sm text-gray-400">Aucune commande sur la période.</p>
          ) : (
            <ul className="space-y-2.5">
              {data.orderStatusCounts.map((s) => (
                <li key={s.status} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-dark-6">{ORDER_STATUS_LABEL[s.status] ?? s.status}</span>
                  <span className="font-medium text-dark dark:text-white">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Appointment status breakdown ────────────────────────────────────── */}
      <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <h2 className="mb-4 text-lg font-bold text-dark dark:text-white">Statuts des rendez-vous</h2>
        {data.appointmentStatusCounts.length === 0 ? (
          <p className="text-sm text-gray-400">Aucun rendez-vous sur la période.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {data.appointmentStatusCounts.map((s) => (
              <div key={s.status} className="rounded-lg border border-stroke px-4 py-3 dark:border-dark-3">
                <p className="text-xl font-bold text-dark dark:text-white">{s.count}</p>
                <p className="text-xs text-gray-500 dark:text-dark-6">{APPOINTMENT_STATUS_LABEL[s.status] ?? s.status}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
