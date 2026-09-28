import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { getProductPerformanceReport } from "@/actions/boutique/stock";
import { StockMovementsTabs } from "@/components/dashboard/boutique/StockMovementsTabs";
import { ProductPerformanceClient } from "@/components/dashboard/boutique/ProductPerformanceClient";

export const metadata = {
  title: "Performance par produit — Dashboard",
  description: "Ventes, marge et rotation du stock de chaque produit sur 3, 6 ou 12 mois — garder ou retirer.",
};

export const dynamic = "force-dynamic";

export default async function ProductPerformancePage({ searchParams }) {
  // Same gate as the ledger next door: the figures are built from the same
  // stock movements, plus revenue per product — no payment or customer detail.
  await requireDashboardPermission(STAFF_PERMISSIONS.BOUTIQUE_STOCK);
  const params = (await searchParams) ?? {};

  const result = await getProductPerformanceReport({
    months: typeof params?.mois === "string" ? params.mois : undefined,
    from: typeof params?.du === "string" ? params.du : undefined,
    to: typeof params?.au === "string" ? params.au : undefined,
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
          Comment chaque produit s'est comporté sur plusieurs mois — ventes, chiffre d'affaires, marge, stock
          restant — pour décider de le garder, d'arrêter de le recommander ou de le retirer.
        </p>
      </div>

      <StockMovementsTabs active="performance" />

      {!result.success ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      ) : (
        <ProductPerformanceClient data={result.data} />
      )}
    </div>
  );
}
