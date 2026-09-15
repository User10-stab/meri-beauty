import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { getStockMovementsReport } from "@/actions/boutique/stock";
import { StockMovementsFilterBar } from "@/components/dashboard/boutique/StockMovementsFilterBar";
import { StockMovementsClient } from "@/components/dashboard/boutique/StockMovementsClient";

export const metadata = {
  title: "Mouvements de stock — Dashboard",
  description: "Journal de tous les mouvements de stock, y compris les corrections manuelles.",
};

export const dynamic = "force-dynamic";

export default async function StockMovementsPage({ searchParams }) {
  // Same gate as the Stock page itself — staff who can adjust stock can also
  // see where those adjustments end up, they're not sensitive financial data
  // the way the Livre de recettes is.
  await requireDashboardPermission(STAFF_PERMISSIONS.BOUTIQUE_STOCK);
  const params = (await searchParams) ?? {};

  const result = await getStockMovementsReport({
    from: typeof params?.from === "string" ? params.from : undefined,
    to: typeof params?.to === "string" ? params.to : undefined,
    type: typeof params?.type === "string" ? params.type : undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/dashboard/boutique/stock"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-primary dark:text-dark-6"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Retour au stock
        </Link>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Mouvements de stock</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Journal de tous les mouvements — réapprovisionnements, ventes, pertes, utilisations en prestation
          et corrections manuelles — tous produits confondus. C'est ici qu'un ajustement de stock devient
          visible et exportable.
        </p>
      </div>

      <StockMovementsFilterBar filters={result.data?.filters} />

      {!result.success ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      ) : (
        <StockMovementsClient data={result.data} />
      )}
    </div>
  );
}
