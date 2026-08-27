import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { listReturnRequests } from "@/actions/boutique/returns";
import { ReturnsPageClient } from "@/components/dashboard/boutique/ReturnsPageClient";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations();
  return {
    title: `${t("dashboardBoutique.returns.title")} — ${t("dashboardBoutique.title")} — Dashboard`,
    description: t("dashboardBoutique.returns.subtitle"),
  };
}

export default async function ReturnsPage() {
  await requireDashboardPermission(STAFF_PERMISSIONS.RETURNS);
  const t = await getTranslations("dashboardBoutique.returns");

  const result = await listReturnRequests();

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

      <ReturnsPageClient initialRequests={result.data ?? []} initialTotalCount={result.totalCount ?? 0} />
    </div>
  );
}
