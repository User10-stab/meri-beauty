import { requireAdmin } from "@/lib/route-protection";
import { getAdminOperations } from "@/actions/dashboard/admin-operations";
import { AdminOperationsClient } from "@/components/dashboard/operations/AdminOperationsClient";

export const metadata = {
  title: "Opérations — Dashboard",
  description: "Transactions, commandes et réservations de Meri Beauty.",
};

export const dynamic = "force-dynamic";

export default async function OperationsPage({ searchParams }) {
  await requireAdmin(false);
  const params = await searchParams;
  const result = await getAdminOperations({ tab: params?.tab, page: params?.page, type: params?.type, status: params?.status });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Opérations</h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          Toutes les transactions, commandes et réservations de la boutique, des ateliers, événements et formations.
        </p>
      </div>
      {result.message ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{result.message}</div> : null}
      <AdminOperationsClient result={result} />
    </div>
  );
}
