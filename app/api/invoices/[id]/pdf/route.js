import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canAccessDashboard, isAdminRole, isTillCashOperator } from "@/lib/authorization";
import { renderInvoicePdf } from "@/lib/pdf/render";

// react-pdf needs Node APIs — not edge-compatible.
export const runtime = "nodejs";

/**
 * Who may fetch an invoice PDF.
 *
 * OWNER/ADMIN: any invoice. Browsing the full ledger lives in Opérations,
 * which is admin-only for the same reason.
 *
 * STAFF: only the salon's own staff account, Marie Mercier
 * (isTillCashOperator, despite her STAFF role). An invoice is a document in
 * the salon's name, and since 16/09/2026 no independent practitioner
 * generates, sends or reprints one — whatever her dashboard permissions.
 * (Before that, staff could read invoices for their own rendez-vous and for
 * ateliers/formations; that per-permission scoping is gone.)
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
  return isTillCashOperator(session.user);
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
          appointment: { select: { userId: true } },
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
