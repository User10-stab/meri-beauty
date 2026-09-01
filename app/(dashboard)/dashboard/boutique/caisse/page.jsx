import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { getCurrentCashSession, listCashSessions } from "@/actions/dashboard/cash-sessions";
import { listCashMovements } from "@/actions/dashboard/cash-movements";
import { CashSessionClient } from "@/components/dashboard/boutique/CashSessionClient";

export const metadata = { title: "Clôture de caisse — Meri Beauty" };

export const dynamic = "force-dynamic";

export default async function CashSessionPage() {
  await requireDashboardPermission(STAFF_PERMISSIONS.CASH_REGISTER);

  const [current, history] = await Promise.all([getCurrentCashSession(), listCashSessions({ pageSize: 20 })]);

  // Only fetched when a session is open — recording a movement is refused
  // server-side without one, so there is nothing to show otherwise.
  const movements =
    current.success && current.data ? await listCashMovements(current.data.id) : { success: true, data: [] };

  return (
    <CashSessionClient
      initialCurrent={current.success ? current.data : null}
      initialHistory={history.success ? history.data : []}
      initialSummary={history.success ? history.summary : null}
      initialMovements={movements.success ? movements.data : []}
    />
  );
}
