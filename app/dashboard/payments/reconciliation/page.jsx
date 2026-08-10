import { requireRole } from "@/lib/route-protection";
import { DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { listStuckPayments } from "@/actions/dashboard/webhook-recovery";
import { ReconciliationPageClient } from "@/components/dashboard/payments/ReconciliationPageClient";

export const metadata = {
  title: "Réconciliation — Dashboard",
  description: "Paiements en attente de remboursement suite à un webhook Stripe manqué ou échoué.",
};

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  await requireRole(DASHBOARD_PERMISSIONS.PAYMENT_RECONCILIATION); // OWNER/ADMIN only — requireReconciliationAccess() re-checks server-side

  const result = await listStuckPayments();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Réconciliation des paiements</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Paiements dont le remboursement Stripe est resté en attente ou a échoué (webhook manqué, appel Stripe en erreur) — à traiter ici plutôt qu&apos;en fouillant les logs.
        </p>
      </div>

      {result.message && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      <ReconciliationPageClient initialPayments={result.data ?? []} />
    </div>
  );
}
