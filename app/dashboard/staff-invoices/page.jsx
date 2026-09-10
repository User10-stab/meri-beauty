import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import {
  listStaffMonthlyInvoices,
  getMonthlyBillingStats,
  getStaffListForFilter,
} from "@/actions/dashboard/staff-invoices";
import { StaffInvoicesClient } from "@/components/dashboard/staff-invoices/StaffInvoicesClient";

export const metadata = { title: "Facturation mensuelle — Meri Beauty" };
export const dynamic = "force-dynamic";

export default async function StaffInvoicesPage({ searchParams }) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) redirect("/dashboard");

  const params = await searchParams;

  const page    = Math.max(1, Number(params?.page)  || 1);
  const status  = params?.status  || "ALL";
  const year    = params?.year    ? Number(params.year)    : undefined;
  const month   = params?.month   ? Number(params.month)   : undefined;
  const staffId = params?.staffId || undefined;

  const [listResult, stats, staffList] = await Promise.all([
    listStaffMonthlyInvoices({ page, pageSize: 50, status, year, month, staffId }),
    getMonthlyBillingStats(),
    getStaffListForFilter(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">
          Facturation mensuelle — Staff
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-dark-6">
          Historique des factures générées automatiquement chaque mois pour les membres du staff.
        </p>
      </div>

      <StaffInvoicesClient
        initialRows={listResult.rows}
        initialTotal={listResult.total}
        initialPage={page}
        totalPages={listResult.totalPages}
        stats={stats}
        staffList={staffList}
        currentStatus={status}
        currentYear={year   ?? null}
        currentMonth={month ?? null}
        currentStaffId={staffId ?? null}
      />
    </div>
  );
}
