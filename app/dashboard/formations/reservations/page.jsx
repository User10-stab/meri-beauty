import Link from "next/link";
import { UserPlus } from "lucide-react";
import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS, canUseSalonTill } from "@/lib/authorization";
import { getFormationReservations } from "@/actions/formations/get-reservations";
import { ReservationsPageClient } from "@/components/dashboard/formations/ReservationsPageClient";

export const metadata = {
  title: "Réservations — Formations",
  description: "Consultez les réservations de formations.",
};

export const dynamic = "force-dynamic";

export default async function FormationReservationsPage({ searchParams }) {
  const { user } = await requireDashboardPermission(STAFF_PERMISSIONS.FORMATION_RESERVATIONS);

  // Notification deep-link: focuses one exact reservation in the client.
  const params = await searchParams;
  const focusReservationId =
    typeof params?.reservationId === "string" && params.reservationId
      ? params.reservationId
      : null;

  const [result, canCollectCash] = await Promise.all([getFormationReservations(), canUseSalonTill(user)]);
  const reservations = result.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark dark:text-white">Réservations</h1>
          <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
            Toutes les réservations de formations, privées et de groupe confondues.
          </p>
        </div>
        {/* A seat booked by hand goes through the till's booking composer:
            paid on the spot, or « Virement » — held, and confirmed to the
            client once the transfer is accepted. */}
        {canCollectCash && (
          <Link
            href="/dashboard/boutique/point-of-sale"
            title="Ouvre la caisse : cherchez la formation, choisissez la date et l'élève, puis « Virement » si elle paie par virement."
            className="inline-flex items-center gap-2 self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <UserPlus className="h-4 w-4" strokeWidth={1.75} />
            Inscrire une élève
          </Link>
        )}
      </div>

      {result.message && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      <ReservationsPageClient
        initialReservations={reservations}
        userRole={user.role}
        canCollectCash={canCollectCash}
        focusReservationId={focusReservationId}
      />
    </div>
  );
}
