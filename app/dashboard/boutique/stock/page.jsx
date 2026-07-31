import { requireAdmin } from "@/lib/route-protection";
import { getAllVariants } from "@/actions/boutique/stock";
import { StockPageClient } from "@/components/dashboard/boutique/StockPageClient";

export const metadata = {
  title: "Stock — Boutique — Dashboard",
  description: "Suivez et ajustez le stock de chaque déclinaison.",
};

export const dynamic = "force-dynamic";

export default async function StockPage() {
  await requireAdmin();

  const result = await getAllVariants();
  const variants = result.data ?? [];
  const lowStockCount = variants.filter((v) => v.isLowStock).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark dark:text-white">Stock</h1>
          <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
            Une déclinaison par ligne. Disponible = stock − réservé par des commandes en cours.
          </p>
        </div>
        {lowStockCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2 text-amber-700">
            <span className="text-xl font-bold leading-none">{lowStockCount}</span>
            <span className="text-xs font-medium">stock bas</span>
          </div>
        )}
      </div>

      {result.message && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      <StockPageClient initialVariants={variants} />
    </div>
  );
}
