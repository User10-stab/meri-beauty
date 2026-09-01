import { auth } from "@/auth";
import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS, hasDashboardPermission } from "@/lib/authorization";
import { PointOfSaleClient } from "@/components/dashboard/boutique/PointOfSaleClient";
import { CounterPanel } from "@/components/dashboard/boutique/CounterPanel";

export const metadata = { title: "Caisse — Meri Beauty" };

export default async function PointOfSalePage() {
  await requireDashboardPermission(STAFF_PERMISSIONS.POINT_OF_SALE);

  const session = await auth();

  // POINT_OF_SALE and BOUTIQUE_STOCK are separate permissions — a cashier can
  // hold the first without the second. The search results only offer the
  // "corriger le stock" shortcut on an out-of-stock line when the person can
  // actually act on it; everyone else is told to ask a manager instead.
  //
  // The counter panel is gated the same way per capability it exposes:
  // checking someone in or settling their balance needs the matching
  // reservation permission (APPOINTMENTS / WORKSHOP_RESERVATIONS /
  // FORMATION_RESERVATIONS — which kind of code it turns out to be is then
  // decided per code, server-side, in actions/activities/check-in.js), and
  // routing a boutique pickup code needs ORDERS. Someone holding none of
  // these would only ever see a panel with nothing it can act on — hide it
  // outright instead.
  const [canAdjustStock, canAppointments, canWorkshops, canFormations, canOrders, canOpenCashSession] = await Promise.all([
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.BOUTIQUE_STOCK),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.FORMATION_RESERVATIONS),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.ORDERS),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.CASH_REGISTER),
  ]);

  return (
    <div className="space-y-6">
      <CounterPanel
        canCheckIn={canAppointments || canWorkshops || canFormations}
        canSettle={canAppointments || canWorkshops || canFormations}
        canPickup={canOrders}
      />
      <PointOfSaleClient canAdjustStock={canAdjustStock} canOpenCashSession={canOpenCashSession} />
    </div>
  );
}
