import { requireDashboard } from "@/lib/route-protection";
import { listReturnRequests } from "@/actions/boutique/returns";
import { ReturnsPageClient } from "@/components/dashboard/boutique/ReturnsPageClient";

export const metadata = {
  title: "Retours — Boutique — Dashboard",
  description: "Demandes de retour dans le délai de rétractation de 14 jours.",
};

export const dynamic = "force-dynamic";

export default async function ReturnsPage() {
  await requireDashboard(); // OWNER/ADMIN/STAFF — requireOrdersAccess() in the action layer re-checks server-side

  const result = await listReturnRequests();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Retours</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Demandes de retour reçues des clients — droit de rétractation de 14 jours.
        </p>
      </div>

      {result.message && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      <ReturnsPageClient initialRequests={result.data ?? []} />
    </div>
  );
}
