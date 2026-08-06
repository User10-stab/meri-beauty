import { requireAdmin } from "@/lib/route-protection";
import { listPromoCodes } from "@/actions/promo-codes";
import { PromoCodesPageClient } from "@/components/dashboard/promo-codes/PromoCodesPageClient";

export const metadata = {
  title: "Codes promo — Dashboard",
  description: "Gérez les codes de réduction utilisables sur la boutique, les ateliers, les formations et les rendez-vous.",
};

export const dynamic = "force-dynamic";

export default async function PromoCodesPage() {
  await requireAdmin();

  const result = await listPromoCodes();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Codes promo</h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          Ces codes s'appliquent à la boutique, aux ateliers/événements, aux formations et aux rendez-vous.
        </p>
      </div>

      {result.message && !result.success && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      <PromoCodesPageClient initialPromoCodes={result.data ?? []} />
    </div>
  );
}
