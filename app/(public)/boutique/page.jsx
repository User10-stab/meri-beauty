import { getStorefrontProducts, getStorefrontFilters } from "@/actions/boutique/storefront";
import { BoutiquePageClient } from "@/components/boutique/BoutiquePageClient";
import { STOREFRONT_PAGE_SIZE } from "@/lib/boutique/storefront-pagination";
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
  // Seule la première page est rendue côté serveur (indexable) ; le reste du
  // catalogue est chargé à la demande par « Voir plus » (BoutiquePageClient).
  // Chaque fiche produit reste découvrable par Google via le sitemap.
  const [productsResult, filtersResult] = await Promise.all([
    getStorefrontProducts({ limit: STOREFRONT_PAGE_SIZE }),
    getStorefrontFilters(),
  ]);

  return (
    <BoutiquePageClient
      initialProducts={productsResult.data ?? []}
      initialTotal={productsResult.total ?? productsResult.data?.length ?? 0}
      categories={filtersResult.data?.categories ?? []}
      brands={filtersResult.data?.brands ?? []}
    />
  );
}
