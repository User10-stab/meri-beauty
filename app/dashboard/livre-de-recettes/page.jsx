import { requireRole } from "@/lib/route-protection";
import { DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { getRecettesJournal } from "@/actions/dashboard/get-recettes-journal";
import { RecettesFilterBar } from "@/components/dashboard/recettes/RecettesFilterBar";
import { RecettesJournalClient } from "@/components/dashboard/recettes/RecettesJournalClient";

export const metadata = {
  title: "Livre de recettes — Dashboard",
  description: "Journal chronologique de toutes les recettes, tous moyens de paiement.",
};

export const dynamic = "force-dynamic";

export default async function LivreDeRecettesPage({ searchParams }) {
  await requireRole(DASHBOARD_PERMISSIONS.REPORTS); // OWNER/ADMIN only — getRecettesJournal() re-checks server-side
  const params = await searchParams;

  const result = await getRecettesJournal({
    from: typeof params?.from === "string" ? params.from : undefined,
    to: typeof params?.to === "string" ? params.to : undefined,
    method: typeof params?.method === "string" ? params.method : undefined,
    category: typeof params?.category === "string" ? params.category : undefined,
    // Deep-link preset from a dashboard revenue card (validated inside the
    // action — unknown ids are ignored, never widen the journal).
    staffId: typeof params?.staffId === "string" ? params.staffId : undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Livre de recettes</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Journal chronologique de toutes les recettes encaissées — espèces, carte et en ligne, y compris
          les espèces perçues hors caisse. Ne se rapproche pas 1:1 du Livre de caisse, qui ne couvre qu'une
          session de caisse.
        </p>
      </div>

      <RecettesFilterBar filters={result.data?.filters} />

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
