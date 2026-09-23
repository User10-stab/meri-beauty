import { Suspense } from "react";
import { requireRole } from "@/lib/route-protection";
import { ROLES } from "@/lib/authorization";
import { ProspectsClient } from "@/components/dashboard/marketing/ProspectsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Prospects",
};

export default async function ProspectsPage() {
  // Marketing réservé OWNER/ADMIN — le staff ne voit pas cette section.
  await requireRole([ROLES.OWNER, ROLES.ADMIN]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Prospects</h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          Suivi des prospects du salon : statuts, activités, campagnes et prochaines actions.
        </p>
      </div>

      <Suspense fallback={<ProspectsSkeleton />}>
        <ProspectsClient />
      </Suspense>
    </div>
  );
}

function ProspectsSkeleton() {
  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex items-center justify-between border-b border-stroke px-6 py-4 dark:border-dark-3">
        <div className="h-9 w-64 animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
        <div className="h-9 w-32 animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
      </div>
      <div className="divide-y divide-stroke dark:divide-dark-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4">
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/5 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
            </div>
            <div className="h-6 w-20 animate-pulse rounded-full bg-gray-100 dark:bg-dark-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
