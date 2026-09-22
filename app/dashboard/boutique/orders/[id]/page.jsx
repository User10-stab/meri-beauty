import { notFound } from "next/navigation";
import { requireTillCashOperator } from "@/lib/route-protection";
import { isAdminRole } from "@/lib/authorization";
import { getOrderById } from "@/actions/boutique/orders";
import { OrderDetailClient } from "@/components/dashboard/boutique/OrderDetailClient";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }) {
  const { user } = await requireTillCashOperator();

  const { id } = await params;
  const result = await getOrderById(id);

  if (!result.success) notFound();

  // Gates the "Annuler quand même" override for a labelled Mondial Relay
  // order — mirrors the server-side check in cancelOrder itself.
  return <OrderDetailClient order={result.data} isAdmin={isAdminRole(user.role)} />;
}
