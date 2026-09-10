import { notFound } from "next/navigation";
import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS, hasDashboardPermission } from "@/lib/authorization";
import { getCashBookLedger } from "@/actions/dashboard/cash-book";
import { listCashMovements } from "@/actions/dashboard/cash-movements";
import { listSessionWithdrawals } from "@/actions/dashboard/bank-deposits";
import { CashBookClient } from "@/components/dashboard/boutique/CashBookClient";

export const metadata = { title: "Livre de caisse — Meri Beauty" };

export const dynamic = "force-dynamic";

export default async function CashBookPage({ params }) {
  const { user } = await requireDashboardPermission(STAFF_PERMISSIONS.CASH_REGISTER);

  const { sessionId } = await params;
  const ledger = await getCashBookLedger(sessionId);
  if (!ledger.success) notFound();

  // This opening's own drawer movements and its trips to the bank, fetched
  // alongside the book they belong to — both used to live on other pages.
  const [movements, withdrawals, canSendTicketEmail] = await Promise.all([
    listCashMovements(sessionId),
    listSessionWithdrawals(sessionId),
    hasDashboardPermission(user, STAFF_PERMISSIONS.SEND_TICKET_EMAIL),
  ]);

  return (
    <CashBookClient
      ledger={ledger.data}
      movements={movements.success ? movements.data : []}
      withdrawals={withdrawals.success ? withdrawals.data : []}
      canSendTicketEmail={canSendTicketEmail}
    />
  );
}
