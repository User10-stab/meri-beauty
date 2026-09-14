import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { getRecettesJournal } from "@/actions/dashboard/get-recettes-journal";
import { RecettesFilterBar } from "@/components/dashboard/recettes/RecettesFilterBar";
import { RecettesJournalClient } from "@/components/dashboard/recettes/RecettesJournalClient";

export const metadata = {
  title: "Mes recettes — Dashboard",
  description: "Journal chronologique des recettes que vous avez personnellement encaissées, tous moyens de paiement.",
};

export const dynamic = "force-dynamic";

export default async function LivreDeRecettesPage({ searchParams }) {
  // OWNER/ADMIN always pass; STAFF needs MY_RECEIPTS granted — getRecettesJournal() re-checks server-side.
  await requireDashboardPermission(STAFF_PERMISSIONS.MY_RECEIPTS);
  const params = await searchParams;

  const result = await getRecettesJournal({
    from: typeof params?.from === "string" ? params.from : undefined,
    to: typeof params?.to === "string" ? params.to : undefined,
    method: typeof params?.method === "string" ? params.method : undefined,
    category: typeof params?.category === "string" ? params.category : undefined,
  });

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-col gap-1 print:hidden">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Mes recettes</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Journal chronologique des recettes que vous avez personnellement encaissées — espèces, carte et en
          ligne, y compris les espèces perçues hors caisse. Ne montre que vos propres encaissements, pas ceux
          du reste de l'équipe, et ne se rapproche donc pas 1:1 du Livre de caisse.
        </p>
      </div>

      <div className="print:hidden">
        <RecettesFilterBar filters={result.data?.filters} />
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
        <RecettesJournalClient data={result.data} />
      )}
    </div>
  );
}
