import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/route-protection";
import { getProductById } from "@/actions/boutique/products";
import { getProductCategories } from "@/actions/boutique/categories";
import { getBrands } from "@/actions/boutique/brands";
import { ProductEditor } from "@/components/dashboard/boutique/ProductEditor";

export const metadata = {
  title: "Modifier le produit — Boutique — Dashboard",
};

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }) {
  await requireAdmin();
  const { id } = await params;

  const [productResult, categoriesResult, brandsResult] = await Promise.all([
    getProductById(id),
    getProductCategories(),
    getBrands({ includeInactive: true }),
  ]);

  if (!productResult.success) notFound();

  return (
    <ProductEditor
      product={productResult.data}
      categories={categoriesResult.data ?? []}
      brands={brandsResult.data ?? []}
    />
  );
}
