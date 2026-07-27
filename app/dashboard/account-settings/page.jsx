import { Suspense } from "react";
import { getStaffSettings } from "@/actions/staff/get-staff-settings";
import { AccountSettingsClient } from "@/components/dashboard/account-settings/AccountSettingsClient";

export const metadata = {
  title: "Mon compte — Dashboard",
  description: "Gérez votre profil, contrat, paramètres de réservation et horaires.",
};

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const result = await getStaffSettings();

  const settings = result.success ? result.data : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">
          Mon compte
        </h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          Gérez votre profil, votre contrat et vos préférences.
        </p>
      </div>

      {result.message && !result.success && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      <Suspense fallback={<SettingsSkeleton />}>
        <AccountSettingsClient initialData={settings} />
      </Suspense>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-stroke bg-white shadow-sm dark:border-dark-3 dark:bg-gray-dark dark:shadow-card"
        >
          <div className="border-b border-stroke px-8 py-5 dark:border-dark-3">
            <div className="h-5 w-48 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
          </div>
          <div className="space-y-4 p-8">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="h-10 w-full animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
