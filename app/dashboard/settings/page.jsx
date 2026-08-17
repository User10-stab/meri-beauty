import { Suspense } from "react";
import { requireAdmin } from "@/lib/route-protection";
import { getSalon } from "@/actions/salon/get-salon";
import { listAdminAccounts } from "@/actions/dashboard/admin-accounts";
import { SalonSettingsClient } from "@/components/dashboard/settings/SalonSettingsClient";

export const metadata = {
  title: "Paramètres du salon — Dashboard",
  description: "Gérez les informations publiques de votre salon.",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user } = await requireAdmin();

  const [result, adminsResult] = await Promise.all([getSalon(), listAdminAccounts()]);
  const salon = result.data ?? null;
  const admins = adminsResult.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark dark:text-white">
            Paramètres du salon
          </h1>
          <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
            Gérez les informations publiques, horaires et fermetures de votre salon.
          </p>
        </div>
      </div>

      {result.message && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      <Suspense fallback={<SettingsSkeleton />}>
        <SalonSettingsClient initialData={salon} initialAdmins={admins} currentUserId={user.id} />
      </Suspense>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card"
        >
          <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
            <div className="h-5 w-48 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
          </div>
          <div className="space-y-4 p-6">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="h-10 w-full animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
