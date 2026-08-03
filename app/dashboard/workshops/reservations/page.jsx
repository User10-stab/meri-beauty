import { requireRole } from "@/lib/route-protection";
import { DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { getWorkshopReservations } from "@/actions/workshops/get-reservations";
import { ReservationsPageClient } from "@/components/dashboard/workshops/ReservationsPageClient";

export const metadata = {
  title: "Réservations — Workshops & Événements",
  description: "Consultez et gérez les réservations d'ateliers et d'événements.",
};

export const dynamic = "force-dynamic";

export default async function WorkshopReservationsPage() {
  const { user } = await requireRole(DASHBOARD_PERMISSIONS.WORKSHOP_RESERVATIONS);

  const result = await getWorkshopReservations();
  const reservations = result.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Réservations</h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          Toutes les réservations d'ateliers et d'événements, tous animateurs confondus.
        </p>
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

      <ReservationsPageClient initialReservations={reservations} userRole={user.role} />
    </div>
  );
}
