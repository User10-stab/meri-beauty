import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import {
  canAccessDashboard,
  getStaffId,
  hasDashboardPermission,
  isAdminRole,
  ROLES,
  STAFF_PERMISSIONS,
} from "@/lib/authorization";
import { renderInvoicePdf } from "@/lib/pdf/render";

// react-pdf needs Node APIs — not edge-compatible.
export const runtime = "nodejs";

/**
 * Who may fetch an invoice PDF.
 *
 * OWNER/ADMIN: any invoice. Browsing the full ledger lives in Opérations,
 * which is admin-only for the same reason.
 *
 * STAFF: only invoices belonging to work they are actually authorised for.
 * This used to be a flat `canAccessDashboard` check, which meant a staff
 * member granted nothing but "Rendez-vous" could pull any customer's boutique
 * invoice — name, address, VAT number, every line item — by guessing an id.
 * The permission that gates the screen now gates the document too:
 *
 *   order (boutique or counter sale) -> ORDERS or POINT_OF_SALE
 *   appointment                      -> APPOINTMENTS, and only their own,
 *                                       mirroring "uniquement ses propres
 *                                       rendez-vous" (STAFF_PERMISSION_OPTIONS)
 *                                       and authorizeAppointmentAction
 *   atelier reservation              -> WORKSHOP_RESERVATIONS
 *   formation reservation            -> FORMATION_RESERVATIONS
 *
 * Atelier/formation viewing is deliberately flat rather than own-session-only:
 * that matches the WORKSHOP_RESERVATIONS/FORMATION_RESERVATIONS gates, where
 * every holder sees every reservation and only mutation is narrowed.
 *
 * A CUSTOMER can only fetch their OWN invoice — ownership is checked across
 * all 4 polymorphic Payment sources (order/appointment/workshopReservation/
 * formationReservation), since Invoice has no direct userId of its own.
 *
 * Every refusal is the same 403 with the same body: which invoices exist, and
 * which belong to whom, is not something an id-guesser should learn from the
 * difference between two error messages.
 */
/**
 * @param {object} session
 * @param {object|null} payment - the invoice's Payment, with its 4 possible sources
 * @returns {Promise<boolean>}
 */
async function staffMayReadInvoice(session, payment) {
  if (!payment) return false;

  if (payment.order) {
    return (
      (await hasDashboardPermission(session.user, STAFF_PERMISSIONS.ORDERS)) ||
      // A cashier settling a counter sale needs its ticket/invoice even
      // without the boutique orders screen.
      (await hasDashboardPermission(session.user, STAFF_PERMISSIONS.POINT_OF_SALE))
    );
  }

  if (payment.appointment) {
    if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS))) return false;
    if (session.user.role !== ROLES.STAFF) return true;
    const ownStaffId = await getStaffId(session);
    // No staff profile means no appointments of their own, so nothing here is
    // theirs to read.
    if (!ownStaffId) return false;
    return payment.appointment.staffService?.staffId === ownStaffId;
  }

  if (payment.workshopReservation) {
    return hasDashboardPermission(session.user, STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS);
  }

  if (payment.formationReservation) {
    return hasDashboardPermission(session.user, STAFF_PERMISSIONS.FORMATION_RESERVATIONS);
  }

  // A Payment with no source at all should not exist (a CHECK constraint
  // enforces exactly one), so this is an unknown shape — refuse rather than
  // fall through to "allowed".
  return false;
}

export async function GET(req, { params }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      lines: true,
      payment: {
        select: {
          // Drives the "PAYÉE / réglée le …" mention on the PDF — selected
          // here so this route doesn't fall back to the extra lookup in
          // lib/pdf/render.jsx#resolvePayment.
          paidAt: true,
          transactionReference: true,
          appointment: { select: { userId: true, staffService: { select: { staffId: true } } } },
          order: { select: { userId: true } },
          workshopReservation: { select: { customerId: true } },
          formationReservation: { select: { customerId: true } },
        },
      },
    },
  });
  if (!invoice) {
    return NextResponse.json({ error: "Facture introuvable." }, { status: 404 });
  }

  const denied = NextResponse.json({ error: "Non autorisé." }, { status: 403 });
  const p = invoice.payment;

  if (!canAccessDashboard(session.user.role)) {
    const ownerId =
      p?.order?.userId ??
      p?.appointment?.userId ??
      p?.workshopReservation?.customerId ??
      p?.formationReservation?.customerId ??
      null;
    if (!ownerId || ownerId !== session.user.id) return denied;
  } else if (!isAdminRole(session.user.role)) {
    if (!(await staffMayReadInvoice(session, p))) return denied;
  }

  const pdf = await renderInvoicePdf(invoice);

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="facture-${invoice.number}.pdf"`,
    },
  });
}
