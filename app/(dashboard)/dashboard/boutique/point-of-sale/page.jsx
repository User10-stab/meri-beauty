import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { validateDashboardAccess, hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { PointOfSaleClient } from "@/components/dashboard/boutique/PointOfSaleClient";

export const metadata = { title: "Caisse — Meri Beauty" };

export default async function PointOfSalePage() {
  const session = await auth();
  if (!validateDashboardAccess(session).valid || !hasPermission(session?.user?.role, DASHBOARD_PERMISSIONS.ORDERS)) redirect("/dashboard");
  return <PointOfSaleClient />;
}
