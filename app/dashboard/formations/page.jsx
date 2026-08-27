import { Suspense } from "react";
import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { getFormations } from "@/actions/formations/get-formations";
import { getFormationStaffOptions } from "@/actions/formations/get-formation-staff";
import { FormationsPageClient } from "@/components/dashboard/formations/FormationsPageClient";

export const metadata = {
  title: "Formations — Dashboard",
  description: "Gérez vos formations privées et de groupe.",
};

export const dynamic = "force-dynamic";

export default async function FormationsPage() {
  const { user } = await requireDashboardPermission(STAFF_PERMISSIONS.FORMATIONS);

  const [formationsResult, staffResult] = await Promise.all([
    getFormations(),
    getFormationStaffOptions(),
  ]);

  const formations = formationsResult.data ?? [];
  const staffOptions = staffResult.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark dark:text-white">Formations</h1>
          <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
            Formations privées (1 personne) et de groupe, avec acompte en ligne et solde réglé au comptoir.
          </p>
        </div>

        <StatBadge
          label="Formations"
          value={formations.length}
          color="bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white"
        />
      </div>

      {formationsResult.message && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {formationsResult.message}
        </div>
      )}

      <Suspense fallback={<FormationsSkeleton />}>
        <FormationsPageClient
          initialFormations={formations}
          initialStaffOptions={staffOptions}
          userRole={user.role}
          currentUserId={user.id}
        />
      </Suspense>
    </div>
  );
}

function StatBadge({ label, value, color }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl px-3.5 py-2 ${color}`}>
      <span className="text-xl font-bold leading-none">{value}</span>
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

function FormationsSkeleton() {
  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex items-center justify-between border-b border-stroke px-6 py-4 dark:border-dark-3">
        <div className="h-9 w-64 animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
        <div className="h-9 w-32 animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
      </div>
      <div className="divide-y divide-stroke dark:divide-dark-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4">
            <div className="h-10 w-16 flex-shrink-0 animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/3 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
            </div>
            <div className="h-6 w-20 animate-pulse rounded-full bg-gray-100 dark:bg-dark-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
