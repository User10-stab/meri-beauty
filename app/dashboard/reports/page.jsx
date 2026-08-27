import { requireRole } from "@/lib/route-protection";
import { DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { getReportsData } from "@/actions/dashboard/get-reports-data";
import { ReportsPageClient } from "@/components/dashboard/reports/ReportsPageClient";
import { ReportsFilterBar } from "@/components/dashboard/reports/ReportsFilterBar";
import { normalizeReportMonths, REPORT_PERIODS } from "@/lib/reports-filters";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }) {
  await requireRole(DASHBOARD_PERMISSIONS.REPORTS); // OWNER/ADMIN only — getReportsData() re-checks server-side
  const t = await getTranslations("dashboard.reports");

  // Filters live in the URL so a report is a shareable link. Both values are
  // re-validated inside getReportsData — a hand-edited query string must not
  // widen the window or slip past the staff lookup.
  const params = await searchParams;
  const months = normalizeReportMonths(params?.months);
  const staffId = typeof params?.staffId === "string" && params.staffId ? params.staffId : null;

  const result = await getReportsData({ months, staffId });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">{t("title")}</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          {t("subtitle")}
        </p>
      </div>

      <ReportsFilterBar
        months={months}
        staffId={staffId}
        periods={result.data?.filters?.periods ?? REPORT_PERIODS}
        staffOptions={result.data?.filters?.staffOptions ?? []}
      />

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
