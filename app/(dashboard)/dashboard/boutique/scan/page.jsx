import { requireTillCashOperator } from "@/lib/route-protection";
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
  await requireTillCashOperator();

  return <ProductScanClient />;
}
