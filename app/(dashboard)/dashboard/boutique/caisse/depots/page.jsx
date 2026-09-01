import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { listUndepositedWithdrawals, listBankDeposits, getCashInTransit } from "@/actions/dashboard/bank-deposits";
import { BankDepositClient } from "@/components/dashboard/boutique/BankDepositClient";

export const metadata = { title: "Dépôts bancaires — Meri Beauty" };

export const dynamic = "force-dynamic";

export default async function BankDepositsPage() {
  await requireDashboardPermission(STAFF_PERMISSIONS.CASH_REGISTER);

  const [undeposited, history, transit] = await Promise.all([
    listUndepositedWithdrawals(),
    listBankDeposits({ pageSize: 20 }),
    getCashInTransit(),
  ]);

  return (
    <BankDepositClient
      initialUndeposited={undeposited.success ? undeposited.data : []}
      initialHistory={history.success ? history.data : []}
      initialTransit={transit.success ? transit.data : null}
    />
  );
}
