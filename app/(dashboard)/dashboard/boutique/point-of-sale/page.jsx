import { auth } from "@/auth";
import { requireSalonTill } from "@/lib/route-protection";
import { STAFF_PERMISSIONS, hasDashboardPermission, isTillCashOperator } from "@/lib/authorization";
import { CounterSurface } from "@/components/dashboard/boutique/counter/CounterSurface";
import { listPendingManualSales } from "@/actions/invoices/manual-invoice";

export const metadata = { title: "Caisse — Meri Beauty" };

export default async function PointOfSalePage({ searchParams }) {
  // Marie, the admins, and any staff member granted CAISSE. What each sale
  // records follows whose sale it is (lib/payments/resolve-payee.js): a
  // boutique sale is always the salon's, her own appointment or formation is
  // hers — see canUseSalonTill.
  await requireSalonTill();

  // « Encaisser » on an unpaid pickup order (orders list) lands here with
  // ?order=<id>: the till opens pre-filled with that order's lines and client.
  const params = await searchParams;
  const sourceOrderId = typeof params?.order === "string" ? params.order : null;

  const session = await auth();

  // CAISSE and BOUTIQUE_STOCK are separate permissions — a cashier can
  // hold the first without the second. The search results only offer the
  // "corriger le stock" shortcut on an out-of-stock line when the person can
  // actually act on it; everyone else is told to ask a manager instead.
  //
  // The counter panel is gated the same way per capability it exposes:
  // checking someone in or settling their balance needs the matching
  // reservation permission (APPOINTMENTS / WORKSHOP_RESERVATIONS /
  // FORMATION_RESERVATIONS — which kind of code it turns out to be is then
  // decided per code, server-side, in actions/activities/check-in.js), and
  // routing a boutique pickup code is the salon's own. Someone holding none of
  // these would only ever see a panel with nothing it can act on — hide it
  // outright instead.
  const isSalonAccount = isTillCashOperator(session.user);
  const [canAdjustStock, canAppointments, canWorkshops, canFormations, pendingManualSales] = await Promise.all([
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.BOUTIQUE_STOCK),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.FORMATION_RESERVATIONS),
    // Invoice sales paid by acompte or later (actions/invoices/manual-invoice.js):
    // collected — and invoiced once fully paid — from right here. The salon's
    // own worklist: never loaded for a CAISSE staff member.
    isSalonAccount ? listPendingManualSales() : Promise.resolve(null),
  ]);

  return (
    <CounterSurface
      canCheckIn={canAppointments || canWorkshops || canFormations}
      canSettle={canAppointments || canWorkshops || canFormations}
      // Boutique pickups and invoice sales (free lines, virement, acompte)
      // stay the salon's own screens — isTillCashOperator, not CAISSE.
      canPickup={isSalonAccount}
      canInvoiceSale={isSalonAccount}
      canCreateWalkInService={canAppointments}
      canCreateSessionBooking={canWorkshops || canFormations}
      canAdjustStock={canAdjustStock}
      canOpenCashSession
      // Everyone who reaches this page may take the SALON's money into the
      // Livre de caisse (a boutique sale always is). An independent's own
      // appointment or formation is still recorded off-till server-side,
      // whoever collects it.
      canCollectCash
      sourceOrderId={sourceOrderId}
      pendingManualSales={pendingManualSales?.success ? pendingManualSales.data : null}
    />
  );
}
