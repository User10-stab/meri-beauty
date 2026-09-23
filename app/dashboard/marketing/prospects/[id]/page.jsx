import { Suspense } from "react";
import { requireRole } from "@/lib/route-protection";
import { ROLES } from "@/lib/authorization";
import { ProspectDetailClient } from "@/components/dashboard/marketing/ProspectDetailClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Fiche prospect",
};

export default async function ProspectDetailPage({ params }) {
  // Marketing réservé OWNER/ADMIN — le staff ne voit pas cette section.
  await requireRole([ROLES.OWNER, ROLES.ADMIN]);
  const { id } = await params;

  return (
    <div className="space-y-6">
      <Suspense fallback={<p className="text-sm text-gray-500">Chargement…</p>}>
        <ProspectDetailClient id={id} />
      </Suspense>
    </div>
  );
}
