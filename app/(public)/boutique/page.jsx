import { getStorefrontProducts, getStorefrontFilters } from "@/actions/boutique/storefront";
import { BoutiquePageClient } from "@/components/boutique/BoutiquePageClient";

export const metadata = {
  title: "Boutique – Meri Beauty",
  description: "Découvrez notre sélection de produits de beauté.",
  alternates: { canonical: "/boutique" },
};

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
