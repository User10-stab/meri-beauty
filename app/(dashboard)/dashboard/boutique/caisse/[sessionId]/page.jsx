import { notFound } from "next/navigation";
import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { getCashBookLedger } from "@/actions/dashboard/cash-book";
import { CashBookClient } from "@/components/dashboard/boutique/CashBookClient";

export const metadata = { title: "Livre de caisse — Meri Beauty" };

export const dynamic = "force-dynamic";

export default async function CashBookPage({ params }) {
  await requireDashboardPermission(STAFF_PERMISSIONS.CASH_REGISTER);

  const { sessionId } = await params;
  const ledger = await getCashBookLedger(sessionId);
  if (!ledger.success) notFound();

  return <CashBookClient ledger={ledger.data} />;
}
