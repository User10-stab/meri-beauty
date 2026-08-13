import { requireDashboard } from "@/lib/route-protection";
import { listOrders } from "@/actions/boutique/orders";
import { OrdersPageClient } from "@/components/dashboard/boutique/OrdersPageClient";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations();
  return {
    title: `${t("dashboardBoutique.orders.title")} — ${t("dashboardBoutique.title")} — Dashboard`,
    description: t("dashboardBoutique.orders.subtitle"),
  };
}

export default async function OrdersPage() {
  await requireDashboard(); // OWNER/ADMIN/STAFF — requireOrdersAccess() in the action layer re-checks server-side
  const t = await getTranslations("dashboardBoutique.orders");

  const result = await listOrders();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">{t("title")}</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          {t("subtitle")}
        </p>
      </div>

      {result.message && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      <OrdersPageClient initialOrders={result.data ?? []} initialTotalCount={result.totalCount ?? 0} />
    </div>
  );
}
