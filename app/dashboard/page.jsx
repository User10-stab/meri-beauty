import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, CalendarDays, Euro, PackageX, UserPlus } from "lucide-react";
import { getDashboardStats } from "@/actions/dashboard/get-dashboard-stats";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/appointment-status";
import { isCurrentUserAdmin } from "@/lib/route-protection";
import { isSellerLegalDataComplete } from "@/lib/invoicing";
import { OverdueOrdersCarousel } from "@/components/dashboard/OverdueOrdersCarousel";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { RevenueTrendChart } from "@/components/dashboard/RevenueTrendChart";

// Mirrors messages/fr.json's dashboardBoutique.orders.overdue.* copy — this
// page doesn't use next-intl (see ORDER_STATUS_LABEL below), so the strings
// are duplicated here rather than wired through useTranslations.
const OVERDUE_REASON_LABEL = {
  NOT_PREPARED: "Pas encore préparée / expédiée",
  NOT_COLLECTED: "Prête depuis plusieurs jours, jamais retirée",
  NOT_CONFIRMED_DELIVERED: "Expédiée, réception jamais confirmée",
};

export const dynamic = "force-dynamic";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateTime(iso) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" }).format(new Date(iso));
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Brussels" }).format(new Date(iso));
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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
  SETTLED_AT_COUNTER: "Encaissée en caisse",
};

export default async function Home({ searchParams }) {
  const params = await searchParams;
  const filterMonth = typeof params?.month === "string" ? params.month : null;

  const [result, legalDataComplete, showFilters] = await Promise.all([
    getDashboardStats({ month: filterMonth }),
    isSellerLegalDataComplete(),
    isCurrentUserAdmin(),
  ]);

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
  const monthLabel = data.monthLabel;

  // ── Card deep-links ──────────────────────────────────────────────────
  // Each card links to its detailed page with the card's exact filters
  // pre-applied (month/date window, statuses), so the target page
  // shows only the data the card counts.
  const [linkYear, linkMonthNum] = data.activeMonth.split("-").map(Number);
  const monthFrom = `${data.activeMonth}-01`;
  const monthTo = `${data.activeMonth}-${new Date(linkYear, linkMonthNum, 0).getDate()}`;
  // Server TZ is pinned to Europe/Brussels (instrumentation.js) — same
  // "today" the card count uses.
  const todayDate = new Date();
  const todayKey = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
  const cardStatuses = [...ACTIVE_APPOINTMENT_STATUSES, "COMPLETED"].join(",");
  // Revenue figures exist for admins only — other roles see €0 with nothing
  // to drill into (the journal page is OWNER/ADMIN-gated anyway).
  const revenueHref = showFilters
    ? `/dashboard/livre-de-recettes?from=${monthFrom}&to=${monthTo}`
    : undefined;
  const appointmentsHref = data.isCurrentMonth
    ? `/dashboard/appointments?date=${todayKey}&statuses=${cardStatuses}`
    : `/dashboard/appointments?month=${data.activeMonth}&statuses=${cardStatuses}`;
  const customersHref = `/dashboard/customers?createdMonth=${data.activeMonth}`;

  return (
    <div className="space-y-6">
      {!legalDataComplete && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-400"
        >
          <span className="mt-0.5 shrink-0 text-lg leading-none">⚠</span>
          <span>
            Identité légale du salon incomplète — tant que{" "}
            <Link href="/dashboard/settings" className="font-medium underline underline-offset-2">
              Réglages &gt; Salon
            </Link>{" "}
            n'est pas rempli (nom légal, TVA, adresse), aucune vente en ligne ne peut être finalisée : les client·es sont bloqué·es avant paiement.
          </span>
        </div>
      )}
      {/* ── Global filters (admins only — recalculated server-side) ──── */}
      {showFilters && (
        <Suspense>
          <DashboardFilters
            activeMonth={data.activeMonth}
            maxMonth={currentMonthKey()}
          />
        </Suspense>
      )}

      {/* ── Stat cards (clickable — deep-link with the card's filters) ─── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Euro size={20} />}
          label={`Chiffre d'affaires — ${monthLabel}`}
          value={formatEuro(data.revenueThisMonth)}
          href={revenueHref}
        />
        <StatCard
          icon={<CalendarDays size={20} />}
          label={data.isCurrentMonth ? "Rendez-vous aujourd'hui" : `Rendez-vous — ${monthLabel}`}
          value={data.appointmentsToday}
          href={appointmentsHref}
        />
        <StatCard
          icon={<UserPlus size={20} />}
          label={`Nouveaux clients — ${monthLabel}`}
          value={data.newCustomersThisMonth}
          href={customersHref}
        />
        <StatCard
          icon={<PackageX size={20} />}
          label="Produits en stock bas"
          value={data.lowStockCount}
          warn={data.lowStockCount > 0}
          href="/dashboard/boutique/stock?lowStock=1"
        />
        <StatCard
          icon={<AlertTriangle size={20} />}
          label="Commandes à traiter"
          value={data.overdueOrdersCount}
          warn={data.overdueOrdersCount > 0}
          href="/dashboard/boutique/orders?overdue=1"
        />
      </div>

      {/* ── Orders needing attention ── */}
      <OverdueOrdersCarousel
        orders={data.overdueOrders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          customerName: o.customerName,
          reasonLabel: OVERDUE_REASON_LABEL[o.reason] ?? o.reason,
          sinceDateLabel: formatDate(o.sinceDate),
        }))}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* ── Revenue trend ────────────────────────────────────────────── */}
        <div className="xl:col-span-2">
          <RevenueTrendChart
            days={data.revenueTrend}
            monthLabel={monthLabel}
            todayKey={todayKey}
            isCurrentMonth={data.isCurrentMonth}
            href={revenueHref}
          />
        </div>

        {/* ── Low stock alerts ─────── */}
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
          <h2 className="mb-4 text-lg font-bold text-dark dark:text-white">
            {data.isCurrentMonth ? "Prochains rendez-vous" : `Rendez-vous — ${monthLabel}`}
          </h2>
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

        {/* ── Recent orders ────────── */}
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

function StatCard({ icon, label, value, warn = false, href }) {
  const className = `flex items-center gap-4 rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card ${
    href ? "transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" : ""
  }`;
  const content = (
    <>
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
    </>
  );
  if (!href) {
    return <div className={className}>{content}</div>;
  }
  return (
    <Link href={href} aria-label={`${label} — voir le détail`} className={className}>
      {content}
    </Link>
  );
}
