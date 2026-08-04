import { requireRole } from "@/lib/route-protection";
import { DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { getWaitingListEntries } from "@/actions/workshops/get-waiting-list";
import { WaitingListPageClient } from "@/components/dashboard/workshops/WaitingListPageClient";

export const metadata = {
  title: "Liste d'attente — Workshops & Événements",
  description: "Consultez la liste d'attente des ateliers et événements complets.",
};

export const dynamic = "force-dynamic";

export default async function WorkshopWaitingListPage() {
  await requireRole(DASHBOARD_PERMISSIONS.WORKSHOP_RESERVATIONS);

  const result = await getWaitingListEntries();
  const entries = result.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Liste d'attente</h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          Personnes en attente d'une place, tous ateliers et événements confondus.
        </p>
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

      <WaitingListPageClient initialEntries={entries} />
    </div>
  );
}
