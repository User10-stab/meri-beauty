import { requireDashboard } from "@/lib/route-protection";
import { listOrders } from "@/actions/boutique/orders";
import { OrdersPageClient } from "@/components/dashboard/boutique/OrdersPageClient";

export const metadata = {
  title: "Commandes — Boutique — Dashboard",
  description: "Suivi et retrait des commandes boutique.",
};

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  await requireDashboard(); // OWNER/ADMIN/STAFF — requireOrdersAccess() in the action layer re-checks server-side

  const result = await listOrders();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Commandes</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Commandes de la boutique en ligne — retrait en salon ou livraison Mondial Relay.
        </p>
      </div>

      {result.message && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      <OrdersPageClient initialOrders={result.data ?? []} initialTotalCount={result.totalCount ?? 0} />
    </div>
  );
}
