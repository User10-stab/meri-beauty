import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { validateDashboardAccess, hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { getCurrentCashSession, listCashSessions } from "@/actions/dashboard/cash-sessions";
import { CashSessionClient } from "@/components/dashboard/boutique/CashSessionClient";

export const metadata = { title: "Clôture de caisse — Meri Beauty" };

export const dynamic = "force-dynamic";

export default async function CashSessionPage() {
  const session = await auth();
  if (!validateDashboardAccess(session).valid || !hasPermission(session?.user?.role, DASHBOARD_PERMISSIONS.ORDERS)) redirect("/dashboard");

  const [current, history] = await Promise.all([getCurrentCashSession(), listCashSessions({ pageSize: 20 })]);

  return (
    <CashSessionClient
      initialCurrent={current.success ? current.data : null}
      initialHistory={history.success ? history.data : []}
    />
  );
}
