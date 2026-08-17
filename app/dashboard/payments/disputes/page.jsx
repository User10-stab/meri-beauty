import { requireRole } from "@/lib/route-protection";
import { DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { listDisputes, listDisputeAssignees } from "@/actions/dashboard/stripe-disputes";
import { DisputesPageClient } from "@/components/dashboard/payments/DisputesPageClient";

export const metadata = {
  title: "Litiges Stripe — Dashboard",
  description: "Dossier des litiges/chargebacks Stripe : responsable, réponse envoyée, preuve, conclusion.",
};

export const dynamic = "force-dynamic";

export default async function DisputesPage() {
  await requireRole(DASHBOARD_PERMISSIONS.STRIPE_DISPUTES); // OWNER/ADMIN only — requireDisputeAccess() re-checks server-side

  const [disputesResult, assigneesResult] = await Promise.all([listDisputes(), listDisputeAssignees()]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Litiges Stripe</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Un dossier par litige/chargeback Stripe — responsable, réponse envoyée, facture, preuve d&apos;expédition ou de retrait, et conclusion.
        </p>
      </div>

      {disputesResult.message && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {disputesResult.message}
        </div>
      )}

      <DisputesPageClient initialDisputes={disputesResult.data ?? []} assignees={assigneesResult.data ?? []} />
    </div>
  );
}
