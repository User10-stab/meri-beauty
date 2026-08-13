import { requireRole } from "@/lib/route-protection";
import { DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { getStaffPerformance } from "@/actions/staff/get-staff-performance";
import { StaffPerformanceClient } from "@/components/dashboard/staff/StaffPerformanceClient";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function StaffPerformancePage() {
  await requireRole(DASHBOARD_PERMISSIONS.STAFF_MANAGEMENT); // OWNER/ADMIN only — getStaffPerformance() re-checks server-side
  const t = await getTranslations("dashboard.staff.performance");

  const result = await getStaffPerformance();

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

      <StaffPerformanceClient initialStaff={result.data ?? []} />
    </div>
  );
}
