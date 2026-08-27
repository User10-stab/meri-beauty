import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { getAllAppointments, getStaffFilterOptions } from "@/actions/appointment/list-appointments";
import { getReviewDashboardData } from "@/actions/review/review-actions";
import { isAdminRole } from "@/lib/authorization";
import { AppointmentsPageClient } from "@/components/dashboard/appointments/AppointmentsPageClient";
import { ReviewsDashboardCard } from "@/components/dashboard/reviews/ReviewsDashboardCard";

export const metadata = {
  title: "Tous les rendez-vous — Dashboard",
};

export const dynamic = "force-dynamic";

export default async function AllAppointmentsPage() {
  const { user } = await requireDashboardPermission(STAFF_PERMISSIONS.APPOINTMENTS);

  const [appointmentsResult, staffResult, reviewsResult] = await Promise.all([
    getAllAppointments(),
    isAdminRole(user.role) ? getStaffFilterOptions() : Promise.resolve({ data: [] }),
    getReviewDashboardData(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Tous les rendez-vous</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          {isAdminRole(user.role)
            ? "Rendez-vous de toute l'équipe."
            : "Vos rendez-vous."}
        </p>
      </div>

      {appointmentsResult.message && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {appointmentsResult.message}
        </div>
      )}

      <ReviewsDashboardCard data={reviewsResult.data} />

      <AppointmentsPageClient
        initialAppointments={appointmentsResult.data ?? []}
        staffOptions={staffResult.data ?? []}
        showStaffFilter={isAdminRole(user.role)}
      />
    </div>
  );
}
