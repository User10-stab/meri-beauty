import { requireAdmin } from "@/lib/route-protection";
import { getBrands } from "@/actions/boutique/brands";
import { ProductEditor } from "@/components/dashboard/boutique/ProductEditor";

export const metadata = {
  title: "Nouveau produit — Boutique — Dashboard",
};

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  await requireAdmin();

  const brandsResult = await getBrands({ includeInactive: true });

  return <ProductEditor product={null} brands={brandsResult.data ?? []} />;
}
