import { CalendarDays, Euro, PackageX, UserPlus } from "lucide-react";
import { getDashboardStats } from "@/actions/dashboard/get-dashboard-stats";

export const dynamic = "force-dynamic";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateTime(iso) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

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

export default async function Home() {
  const result = await getDashboardStats();

  if (!result.success) {
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
      >
        <span className="mt-0.5 shrink-0 text-lg leading-none">⚠</span>
        {result.message}
      </div>
    );
  }

  const data = result.data;
  const maxDailyRevenue = Math.max(1, ...data.revenueTrend.map((d) => d.total));

  return (
    <div className="space-y-6">
      {/* ── Stat cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Euro size={20} />}
          label="Chiffre d'affaires ce mois-ci"
          value={formatEuro(data.revenueThisMonth)}
        />
        <StatCard
          icon={<CalendarDays size={20} />}
          label="Rendez-vous aujourd'hui"
          value={data.appointmentsToday}
        />
        <StatCard
          icon={<UserPlus size={20} />}
          label="Nouveaux clients ce mois-ci"
          value={data.newCustomersThisMonth}
        />
        <StatCard
          icon={<PackageX size={20} />}
          label="Produits en stock bas"
          value={data.lowStockCount}
          warn={data.lowStockCount > 0}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* ── Revenue trend ────────────────────────────────────────────── */}
        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card xl:col-span-2">
          <h2 className="mb-5 text-lg font-bold text-dark dark:text-white">
            Revenus des 7 derniers jours
          </h2>
          <div className="flex h-48 gap-3">
            {data.revenueTrend.map((day) => {
              const heightPct = Math.max(4, (day.total / maxDailyRevenue) * 100);
              return (
                <div key={day.date} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-xs font-medium text-gray-500 dark:text-dark-6">
                    {day.total > 0 ? formatEuro(day.total) : ""}
                  </span>
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t-md bg-[#2f3a2e] dark:bg-white"
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Intl.DateTimeFormat("fr-FR", { weekday: "short" }).format(new Date(day.date))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Low stock alerts ─────────────────────────────────────────── */}
        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <h2 className="mb-4 text-lg font-bold text-dark dark:text-white">Stock bas</h2>
          {data.lowStockItems.length === 0 ? (
            <p className="text-sm text-gray-400">Aucune alerte de stock.</p>
          ) : (
            <ul className="space-y-3">
              {data.lowStockItems.map((item) => (
                <li key={item.id} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-dark dark:text-white">{item.productName}</p>
                    <p className="truncate text-xs text-gray-400">{item.name}</p>
                  </div>
                  <span className="ml-2 shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                    {item.availableQuantity} / {item.lowStockThreshold}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* ── Upcoming appointments ────────────────────────────────────── */}
        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <h2 className="mb-4 text-lg font-bold text-dark dark:text-white">Prochains rendez-vous</h2>
          {data.upcomingAppointments.length === 0 ? (
            <p className="text-sm text-gray-400">Aucun rendez-vous à venir.</p>
          ) : (
            <ul className="divide-y divide-stroke dark:divide-dark-3">
              {data.upcomingAppointments.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-3 text-sm first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-dark dark:text-white">{a.customerName}</p>
                    <p className="truncate text-xs text-gray-400">{a.serviceName} — {a.staffName}</p>
                  </div>
                  <span className="ml-2 shrink-0 text-xs font-medium text-gray-500 dark:text-dark-6">
                    {formatDateTime(a.startTime)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Recent orders ────────────────────────────────────────────── */}
        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <h2 className="mb-4 text-lg font-bold text-dark dark:text-white">Dernières commandes</h2>
          {data.recentOrders.length === 0 ? (
            <p className="text-sm text-gray-400">Aucune commande pour le moment.</p>
          ) : (
            <ul className="divide-y divide-stroke dark:divide-dark-3">
              {data.recentOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between py-3 text-sm first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-dark dark:text-white">
                      Commande n°{o.orderNumber} — {o.customerName}
                    </p>
                    <p className="truncate text-xs text-gray-400">
                      {ORDER_STATUS_LABEL[o.status] ?? o.status} · {formatDate(o.createdAt)}
                    </p>
                  </div>
                  <span className="ml-2 shrink-0 font-medium text-dark dark:text-white">
                    {formatEuro(o.totalAmount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, warn = false }) {
  return (
    <div className="flex items-center gap-4 rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
          warn ? "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400" : "bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-dark dark:text-white">{value}</p>
        <p className="truncate text-sm text-gray-500 dark:text-dark-6">{label}</p>
      </div>
    </div>
  );
}
