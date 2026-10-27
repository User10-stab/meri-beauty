import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMyOrderHistory } from "@/actions/customer/order-history";
import { MonComptePageClient } from "@/components/website/MonComptePageClient";
import { getTranslations } from "next-intl/server";

// Titre traduit selon la langue choisie (cookie NEXT_LOCALE) — MB-008.
export async function generateMetadata() {
  const t = await getTranslations("pageMeta");
  return {
    title: t("myOrdersTitle"),
  };
}

export default async function MonComptePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const result = await getMyOrderHistory();
  const data = result.data ?? { orders: [], workshopReservations: [], formationReservations: [] };

  return <MonComptePageClient {...data} />;
}
