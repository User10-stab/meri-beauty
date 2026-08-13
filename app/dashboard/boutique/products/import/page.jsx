import { requireAdmin } from "@/lib/route-protection";
import { ImportWixClient } from "@/components/dashboard/boutique/ImportWixClient";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("dashboardBoutique.importWix");
  return {
    title: t("metadataTitle"),
  };
}

export default async function ImportWixPage() {
  await requireAdmin();

  return <ImportWixClient />;
}
