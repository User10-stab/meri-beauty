import { requireAdmin } from "@/lib/route-protection";
import { getProductCategories } from "@/actions/boutique/categories";
import { getBrands } from "@/actions/boutique/brands";
import { ProductEditor } from "@/components/dashboard/boutique/ProductEditor";

export const metadata = {
  title: "Nouveau produit — Boutique — Dashboard",
};

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  await requireAdmin();

  const [categoriesResult, brandsResult] = await Promise.all([
    getProductCategories(),
    getBrands({ includeInactive: true }),
  ]);

  return (
    <ProductEditor
      product={null}
      categories={categoriesResult.data ?? []}
      brands={brandsResult.data ?? []}
    />
  );
}
