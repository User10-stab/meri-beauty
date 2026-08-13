import { requireRole } from "@/lib/route-protection";
import { DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { getReportsData } from "@/actions/dashboard/get-reports-data";
import { ReportsPageClient } from "@/components/dashboard/reports/ReportsPageClient";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requireRole(DASHBOARD_PERMISSIONS.REPORTS); // OWNER/ADMIN only — getReportsData() re-checks server-side
  const t = await getTranslations("dashboard.reports");

  const result = await getReportsData();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">{t("title")}</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          {t("subtitle")}
        </p>
      </div>

      {!result.success ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      ) : (
        <ReportsPageClient data={result.data} />
      )}
    </div>
  );
}
