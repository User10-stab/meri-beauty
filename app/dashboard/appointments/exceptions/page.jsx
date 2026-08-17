import { requireAdmin } from "@/lib/route-protection";
import { getCancellationExceptionRequests } from "@/actions/reservation/cancellation-exception-request";
import { CancellationExceptionRequestsClient } from "@/components/dashboard/appointments/CancellationExceptionRequestsClient";

export const metadata = {
  title: "Demandes d'annulation exceptionnelle — Dashboard",
  description: "Examinez les demandes exceptionnelles avant toute annulation ou remboursement.",
};

export const dynamic = "force-dynamic";

export default async function CancellationExceptionRequestsPage() {
  await requireAdmin();
  const result = await getCancellationExceptionRequests();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Demandes d&apos;annulation exceptionnelle</h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">Une demande ne rembourse rien tant qu&apos;un administrateur ne l&apos;a pas acceptée.</p>
      </div>
      {!result.success ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{result.message}</div>
      ) : (
        <CancellationExceptionRequestsClient initialRequests={result.data} />
      )}
    </div>
  );
}
