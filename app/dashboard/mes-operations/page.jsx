import { redirect } from "next/navigation";
import { requireDashboard, getCurrentStaffId } from "@/lib/route-protection";
import { isAdminRole } from "@/lib/authorization";
import { getAdminOperations } from "@/actions/dashboard/admin-operations";
import { AdminOperationsClient } from "@/components/dashboard/operations/AdminOperationsClient";

export const metadata = {
  title: "Mes opérations — Dashboard",
  description: "Vos propres encaissements, commandes et rendez-vous.",
};

export const dynamic = "force-dynamic";

/**
 * A practitioner's own ledger. Every practitioner at Meri Beauty is legally
 * independent, invoicing under her own VAT number, so her sales are hers —
 * they are no longer counted in the salon's books, and this is where she
 * reads them back.
 *
 * Read-only on purpose. The actions on /dashboard/operations (send an
 * invoice, open a refund, reprint a ticket) all produce documents in the
 * salon's name, which is precisely what an independent's sale must not
 * generate. Its own guard is unchanged: /dashboard/operations stays
 * admin-only, and an admin supervising everyone does it from there.
 *
 * The staff id is never taken from the query string — getAdminOperations
 * forces the reader's own, server-side, for any non-admin caller. A
 * hand-edited `?staffId=` cannot read a colleague's takings.
 *
 * Marie Mercier lands here too: her role is STAFF, so /dashboard/operations
 * already redirects her today, and supervision runs from the
 * admin@meribeauty.com account. What she sees here is her own lines — which,
 * unlike anyone else's, are also the salon's.
 */
export default async function MyOperationsPage({ searchParams }) {
  const { user } = await requireDashboard();
  // An admin has the full ledger a click away; sending them to a read-only
  // copy of a subset of it would just be a worse version of the same page.
  if (isAdminRole(user.role)) redirect("/dashboard/operations");

  const staffId = await getCurrentStaffId();
  if (!staffId) redirect("/dashboard");

  const params = await searchParams;
  const result = await getAdminOperations({
    tab: params?.tab,
    page: params?.page,
    type: params?.type,
    lifecycleStatus: params?.lifecycleStatus,
    paymentEvent: params?.paymentEvent,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Mes opérations</h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          Vos encaissements, commandes et rendez-vous. Ces ventes sont les vôtres : elles sont à
          déclarer sous votre propre numéro de TVA et n&apos;apparaissent plus dans les livres du salon.
        </p>
      </div>
      {result.message ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {result.message}
        </div>
      ) : null}
      <AdminOperationsClient result={result} basePath="/dashboard/mes-operations" />
    </div>
  );
}
