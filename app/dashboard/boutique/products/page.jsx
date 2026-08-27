import { Suspense } from "react";
import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS, isAdminRole } from "@/lib/authorization";
import { getProducts } from "@/actions/boutique/products";
import { getBrands } from "@/actions/boutique/brands";
import { ProductsPageClient } from "@/components/dashboard/boutique/ProductsPageClient";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations();
  return {
    title: `${t("dashboardBoutique.products.title")} — ${t("dashboardBoutique.title")} — Dashboard`,
    description: t("dashboardBoutique.products.subtitle"),
  };
}

export default async function ProductsPage() {
  const { user } = await requireDashboardPermission(STAFF_PERMISSIONS.BOUTIQUE_STOCK);
  const isAdmin = isAdminRole(user.role);
  const t = await getTranslations("dashboardBoutique.products");

  // ProductsPageClient has no pagination UI — it filters (search/brand/
  // status) entirely client-side over whatever this fetch returns. A small
  // pageSize here silently hides every product past the cut, with nothing
  // in the UI to suggest more exist (confirmed: a 175-product Wix import
  // only ever showed the first 50). High enough to comfortably cover a
  // single salon's full catalogue; revisit with real server-side pagination
  // if the catalogue ever grows past this.
  const [productsResult, brandsResult] = await Promise.all([
    getProducts({ pageSize: 2000 }),
    getBrands({ includeInactive: true }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">{t("title")}</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          {t("subtitle")}
        </p>
      </div>

      {productsResult.message && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {productsResult.message}
        </div>
      )}

      <Suspense fallback={null}>
        <ProductsPageClient
          initialProducts={productsResult.data ?? []}
          brands={brandsResult.data ?? []}
          isAdmin={isAdmin}
        />
      </Suspense>
    </div>
  );
}
