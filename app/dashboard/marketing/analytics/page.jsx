import { Suspense } from "react";
import { requireRole } from "@/lib/route-protection";
import { ROLES } from "@/lib/authorization";
import { AnalyticsClient } from "@/components/dashboard/marketing/AnalyticsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Google Analytics",
};

export default async function GoogleAnalyticsPage() {
  // Marketing réservé OWNER/ADMIN — comme le reste de la rubrique.
  await requireRole([ROLES.OWNER, ROLES.ADMIN]);

  const data = {
    measurementId: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? null,
    streamId: process.env.NEXT_PUBLIC_GA_STREAM_ID ?? "15932439635",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Google Analytics</h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          Identifiants du flux, état du tracking et accès direct à tes statistiques Google Analytics 4.
        </p>
      </div>

      <Suspense fallback={<p className="text-sm text-gray-500">Chargement…</p>}>
        <AnalyticsClient data={data} />
      </Suspense>
    </div>
  );
}
