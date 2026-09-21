import Link from "next/link";
import { Store } from "lucide-react";
import { requireAdmin } from "@/lib/route-protection";
import { listInvoices } from "@/actions/dashboard/invoices";
import { InvoicesClient } from "@/components/dashboard/invoices/InvoicesClient";
import { listPendingManualSales } from "@/actions/invoices/manual-invoice";
import { PendingManualSales } from "@/components/dashboard/invoices/PendingManualSales";
import { listPendingStaffRent } from "@/actions/invoices/staff-rent";
import { PendingStaffRent } from "@/components/dashboard/invoices/PendingStaffRent";

export const metadata = {
  title: "Factures — Dashboard",
  description: "Toutes les factures émises, leur envoi et leurs notes de crédit.",
};

export const dynamic = "force-dynamic";

export default async function FacturesPage({ searchParams }) {
  await requireAdmin(false); // listInvoices() and every send/credit action re-check the admin role
  const params = await searchParams;

  const [result, pending, staffRent] = await Promise.all([
    listInvoices({
      page: params?.page,
      q: params?.q,
      delivery: params?.delivery,
      source: params?.source,
      from: params?.from,
      to: params?.to,
    }),
    // Manual sales paid by acompte or later: no invoice until fully paid.
    listPendingManualSales(),
    // Staff rent invoices: paid by transfer, pending until accepted.
    listPendingStaffRent(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-dark dark:text-white">Factures</h1>
          <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
            Toutes les factures émises : envoi par e-mail ou Peppol, suivi de livraison et notes de crédit.
          </p>
        </div>
        <Link
          // Invoice sales (free lines, transfer, acompte, pay later) are
          // composed at la caisse — see CounterCart / manual-invoice.js.
          href="/dashboard/boutique/point-of-sale#counter-cart"
          className="inline-flex items-center gap-2 rounded-lg bg-[#2f3a2e] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1f291f]"
        >
          <Store size={16} /> Vendre avec facture
        </Link>
      </div>
      {pending.success && <PendingManualSales data={pending.data} />}
      {staffRent.success && <PendingStaffRent data={staffRent.data} />}
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
