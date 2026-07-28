import { requireAdmin } from "@/lib/route-protection";
import { getProductCategories } from "@/actions/boutique/categories";
import { CategoriesPageClient } from "@/components/dashboard/boutique/CategoriesPageClient";

export const metadata = {
  title: "Catégories — Boutique — Dashboard",
  description: "Organisez le catalogue en catégories et sous-catégories.",
};

export const dynamic = "force-dynamic";

export default async function ProductCategoriesPage() {
  await requireAdmin();

  const result = await getProductCategories({ includeInactive: true });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Catégories</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Chaque produit appartient à une sous-catégorie, elle-même rattachée à une catégorie.
        </p>
      </div>

      {result.message && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      <CategoriesPageClient initialCategories={result.data ?? []} />
    </div>
  );
}
