import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { validateDashboardAccess, hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { ProductScanClient } from "@/components/boutique/ProductScanClient";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("dashboardBoutique.scan");
  return {
    title: t("metadata"),
  };
}

/**
 * In-store barcode/QR scanning for staff to add items to orders.
 * Protected: STAFF and ADMIN can scan (day-to-day operations), but
 * catalogue management (BOUTIQUE) stays admin-only.
 */
export default async function ScanPage() {
  const session = await auth();

  // Must be logged in and have dashboard access
  const validation = validateDashboardAccess(session);
  if (!validation.valid) {
    redirect("/login");
  }

  // ORDERS permission (not BOUTIQUE) — staff can handle counter operations,
  // but catalogue management stays admin-only
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.ORDERS)) {
    redirect("/dashboard");
  }

  return <ProductScanClient />;
}
