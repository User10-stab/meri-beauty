import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canAccessDashboard } from "@/lib/authorization";
import { renderInvoicePdf } from "@/lib/pdf/render";

// react-pdf needs Node APIs — not edge-compatible.
export const runtime = "nodejs";

/**
 * Any dashboard role can fetch any invoice's PDF (they're handling that
 * order/appointment at the counter) — browsing the full ledger is gated
 * separately (DASHBOARD_PERMISSIONS.INVOICES, admin-only) in
 * actions/invoicing.js#listInvoices.
 *
 * A CUSTOMER can only fetch their OWN invoice — ownership is checked across
 * all 4 polymorphic Payment sources (order/appointment/workshopReservation/
 * formationReservation), since Invoice has no direct userId of its own.
 */
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

  if (!canAccessDashboard(session.user.role)) {
    const p = invoice.payment;
    const ownerId =
      p?.order?.userId ??
      p?.appointment?.userId ??
      p?.workshopReservation?.customerId ??
      p?.formationReservation?.customerId ??
      null;
    if (!ownerId || ownerId !== session.user.id) {
      return NextResponse.json({ error: "Non autorisé." }, { status: 403 });
    }
  }

  const pdf = await renderInvoicePdf(invoice);

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="facture-${invoice.number}.pdf"`,
    },
  });
}
