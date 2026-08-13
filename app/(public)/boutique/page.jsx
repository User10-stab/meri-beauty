import { getStorefrontProducts, getStorefrontFilters } from "@/actions/boutique/storefront";
import { BoutiquePageClient } from "@/components/boutique/BoutiquePageClient";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("boutique.metadata");
  return {
    title: t("boutiquePage"),
    description: t("boutiqueDescription"),
    alternates: { canonical: "/boutique" },
  };
}

export default async function BoutiquePage() {
  const [productsResult, filtersResult] = await Promise.all([
    getStorefrontProducts(),
    getStorefrontFilters(),
  ]);

  return (
    <BoutiquePageClient
      initialProducts={productsResult.data ?? []}
      categories={filtersResult.data?.categories ?? []}
      brands={filtersResult.data?.brands ?? []}
    />
  );
}
