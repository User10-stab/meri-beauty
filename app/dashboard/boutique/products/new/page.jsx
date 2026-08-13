import { requireAdmin } from "@/lib/route-protection";
import { getBrands } from "@/actions/boutique/brands";
import { ProductEditor } from "@/components/dashboard/boutique/ProductEditor";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("dashboardBoutique.productEditor");
  return {
    title: t("newMetadataTitle"),
  };
}

export default async function NewProductPage({ searchParams }) {
  await requireAdmin();

  const brandsResult = await getBrands({ includeInactive: true });
  const { barcode } = await searchParams;

  return <ProductEditor product={null} brands={brandsResult.data ?? []} initialBarcode={barcode ?? null} />;
}
