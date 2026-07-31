import { requireDashboard } from "@/lib/route-protection";
import { listInvoices } from "@/actions/invoicing";
import { InvoicesPageClient } from "@/components/dashboard/invoices/InvoicesPageClient";

export const metadata = {
  title: "Factures — Dashboard",
  description: "Factures et notes de crédit — commandes boutique et rendez-vous.",
};

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  await requireDashboard(); // OWNER/ADMIN only — requireInvoicesAccess() in the action layer re-checks server-side

  const result = await listInvoices();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Factures</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Toutes les factures émises — commandes boutique et rendez-vous payés en ligne.
        </p>
      </div>

      {result.message && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      <InvoicesPageClient initialInvoices={result.data ?? []} />
    </div>
  );
}
