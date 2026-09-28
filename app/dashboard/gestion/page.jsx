import { requireRole } from "@/lib/route-protection";
import { DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { getGestionReport } from "@/actions/dashboard/gestion";
import { RecettesFilterBar } from "@/components/dashboard/recettes/RecettesFilterBar";
import { GestionClient } from "@/components/dashboard/gestion/GestionClient";

export const metadata = {
  title: "Gestion — Dashboard",
  description: "Marge nette du salon sur une période : recettes, coût des produits et charges.",
};

export const dynamic = "force-dynamic";

export default async function GestionPage({ searchParams }) {
  await requireRole(DASHBOARD_PERMISSIONS.REPORTS); // OWNER/ADMIN only — getGestionReport() re-checks server-side
  const params = await searchParams;

  const result = await getGestionReport({
    from: typeof params?.from === "string" ? params.from : undefined,
    to: typeof params?.to === "string" ? params.to : undefined,
    category: typeof params?.category === "string" ? params.category : undefined,
  });

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-col gap-1 print:hidden">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Gestion</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Ce que le salon a réellement gagné sur la période, hors TVA : les recettes du Livre de recettes, moins le
          prix d&apos;achat des produits vendus, les charges du salon (loyer, électricité, eau, internet…) et les
          dépenses payées en caisse.
        </p>
      </div>

      <div className="print:hidden">
        <RecettesFilterBar filters={result.data?.filters} basePath="/dashboard/gestion" showMethod={false} />
      </div>

      {!result.success ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      ) : (
        <GestionClient data={result.data} />
      )}
    </div>
  );
}
