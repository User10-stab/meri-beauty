import { requireAdmin } from "@/lib/route-protection";
import { getBrands } from "@/actions/boutique/brands";
import { BrandsPageClient } from "@/components/dashboard/boutique/BrandsPageClient";

export const metadata = {
  title: "Marques — Boutique — Dashboard",
  description: "Gérez les marques vendues en boutique.",
};

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  await requireAdmin();

  const result = await getBrands({ includeInactive: true });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Marques</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Une marque peut regrouper des produits de plusieurs catégories.
        </p>
      </div>

      {result.message && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      <BrandsPageClient initialBrands={result.data ?? []} />
    </div>
  );
}
