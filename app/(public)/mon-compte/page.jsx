import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMyOrderHistory } from "@/actions/customer/order-history";
import { MonComptePageClient } from "@/components/website/MonComptePageClient";

export const metadata = { title: "Mes commandes — Meri Beauty" };

export default async function MonComptePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const result = await getMyOrderHistory();
  const data = result.data ?? { orders: [], workshopReservations: [], formationReservations: [] };

  return <MonComptePageClient {...data} />;
}
