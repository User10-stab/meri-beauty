import { requireAdmin } from "@/lib/route-protection";
import { listInvoices } from "@/actions/dashboard/invoices";
import { InvoicesClient } from "@/components/dashboard/invoices/InvoicesClient";

export const metadata = {
  title: "Factures — Dashboard",
  description: "Toutes les factures émises, leur envoi et leurs notes de crédit.",
};

export const dynamic = "force-dynamic";

export default async function FacturesPage({ searchParams }) {
  await requireAdmin(false); // listInvoices() and every send/credit action re-check the admin role
  const params = await searchParams;

  const result = await listInvoices({
    page: params?.page,
    q: params?.q,
    delivery: params?.delivery,
    source: params?.source,
    from: params?.from,
    to: params?.to,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Factures</h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          Toutes les factures émises : envoi par e-mail ou Peppol, suivi de livraison et notes de crédit.
        </p>
      </div>
      {!result.success ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {result.message}
        </div>
      ) : (
        <InvoicesClient data={result.data} />
      )}
    </div>
  );
}
