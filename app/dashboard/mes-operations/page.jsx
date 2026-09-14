import { requireDashboard } from "@/lib/route-protection";
import { getMyOperations } from "@/actions/dashboard/admin-operations";
import { AdminOperationsClient } from "@/components/dashboard/operations/AdminOperationsClient";

export const metadata = {
  title: "Mes opérations — Dashboard",
  description: "Vos propres transactions, commandes et réservations.",
};

export const dynamic = "force-dynamic";

export default async function MyOperationsPage({ searchParams }) {
  // Any authenticated dashboard role (STAFF included) — getMyOperations()
  // re-checks server-side and always scopes to the caller's own activity.
  await requireDashboard();
  const params = await searchParams;
  const result = await getMyOperations({
    tab: params?.tab,
    page: params?.page,
    type: params?.type,
    lifecycleStatus: params?.lifecycleStatus,
    paymentEvent: params?.paymentEvent,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Mes opérations</h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          Les transactions, commandes et réservations que vous avez personnellement enregistrées — personne
          d'autre, y compris la direction, ne voit ici les opérations d'un autre membre de l'équipe.
        </p>
      </div>
      {result.message ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {result.message}
        </div>
      ) : null}
      <AdminOperationsClient result={result} />
    </div>
  );
}
