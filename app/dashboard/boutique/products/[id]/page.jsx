import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/route-protection";
import { getProductById } from "@/actions/boutique/products";
import { getBrands } from "@/actions/boutique/brands";
import { ProductEditor } from "@/components/dashboard/boutique/ProductEditor";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("dashboardBoutique.productEditor");
  return {
    title: t("editMetadataTitle"),
  };
}

export default async function EditProductPage({ params }) {
  await requireAdmin();
  const { id } = await params;

  const [productResult, brandsResult] = await Promise.all([
    getProductById(id),
    getBrands({ includeInactive: true }),
  ]);

  if (!productResult.success) notFound();

  return <ProductEditor product={productResult.data} brands={brandsResult.data ?? []} />;
}
