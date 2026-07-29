import { requireAdmin } from "@/lib/route-protection";
import { ImportWixClient } from "@/components/dashboard/boutique/ImportWixClient";

export const metadata = {
  title: "Importer depuis Wix — Boutique — Dashboard",
};

export default async function ImportWixPage() {
  await requireAdmin();

  return <ImportWixClient />;
}
