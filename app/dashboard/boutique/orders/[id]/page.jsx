import { notFound } from "next/navigation";
import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS, isAdminRole } from "@/lib/authorization";
import { getOrderById } from "@/actions/boutique/orders";
import { OrderDetailClient } from "@/components/dashboard/boutique/OrderDetailClient";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }) {
  const { user } = await requireDashboardPermission(STAFF_PERMISSIONS.ORDERS);

  const { id } = await params;
  const result = await getOrderById(id);

  if (!result.success) notFound();

  // Issuing a credit note is admin-only server-side (see
  // issueCreditNoteForTransaction) — gating the button here too means an
  // ORDERS-only staff member never sees a control that would just fail for
  // them, instead of relying on the toast error to explain it after a click.
  return <OrderDetailClient order={result.data} isAdmin={isAdminRole(user.role)} />;
}
