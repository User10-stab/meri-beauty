import { Suspense } from "react";
import { requireRole } from "@/lib/route-protection";
import { ROLES } from "@/lib/authorization";
import { CampaignsClient } from "@/components/dashboard/marketing/CampaignsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Campagnes marketing",
};

export default async function CampagnesPage() {
  // Marketing réservé OWNER/ADMIN — le staff ne voit pas cette section.
  await requireRole([ROLES.OWNER, ROLES.ADMIN]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Campagnes marketing</h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          Créez, planifiez et envoyez des campagnes e-mail avec suivi des ouvertures et des clics.
        </p>
      </div>

      <Suspense fallback={<p className="text-sm text-gray-500">Chargement…</p>}>
        <CampaignsClient />
      </Suspense>
    </div>
  );
}
