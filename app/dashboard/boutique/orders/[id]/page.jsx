import { notFound } from "next/navigation";
import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { getOrderById } from "@/actions/boutique/orders";
import { OrderDetailClient } from "@/components/dashboard/boutique/OrderDetailClient";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }) {
  await requireDashboardPermission(STAFF_PERMISSIONS.ORDERS);

  const { id } = await params;
  const result = await getOrderById(id);

  if (!result.success) notFound();

  return <OrderDetailClient order={result.data} />;
}
