import { Suspense } from "react";
import { requireRole } from "@/lib/route-protection";
import { DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { getStripeAccountsForAdmin } from "@/actions/stripe/admin-stripe-accounts";
import { StripeAccountsClient } from "@/components/dashboard/staff/StripeAccountsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Comptes Stripe — Dashboard",
  description: "Comptes Stripe connectés des professionnels et accès autorisés.",
};

export default async function StripeAccountsPage() {
  // OWNER/ADMIN only — getStripeAccountsForAdmin() re-checks server-side.
  await requireRole(DASHBOARD_PERMISSIONS.STAFF_MANAGEMENT);

  const result = await getStripeAccountsForAdmin();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark dark:text-white">
            Comptes Stripe
          </h1>
          <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
            Comptes Stripe connectés des professionnels. Le bouton « Voir le compte »
            n&apos;apparaît que si le professionnel a autorisé l&apos;accès.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-[rgba(47,58,46,0.08)] px-3.5 py-2 text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white">
            <span className="text-xl font-bold leading-none">{(result.data ?? []).length}</span>
            <span className="text-xs font-medium">compte{(result.data ?? []).length > 1 ? "s" : ""}</span>
          </div>
        </div>
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

      <Suspense fallback={<StripeAccountsSkeleton />}>
        <StripeAccountsClient initialData={result.data ?? []} />
      </Suspense>
    </div>
  );
}

function StripeAccountsSkeleton() {
  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="divide-y divide-stroke dark:divide-dark-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4">
            <div className="h-10 w-10 flex-shrink-0 animate-pulse rounded-full bg-gray-100 dark:bg-dark-2" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/5 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
            </div>
            <div className="h-8 w-28 animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
