import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canAccessDashboard } from "@/lib/authorization";
import { renderInvoicePdf } from "@/lib/pdf/render";

// react-pdf needs Node APIs — not edge-compatible.
export const runtime = "nodejs";

/**
 * Any dashboard role can fetch one specific invoice's PDF (they're handling
 * that order/appointment at the counter) — browsing the full ledger is
 * gated separately (DASHBOARD_PERMISSIONS.INVOICES, admin-only) in
 * actions/invoicing.js#listInvoices.
 */
export async function GET(req, { params }) {
  const session = await auth();
  if (!session?.user || !canAccessDashboard(session.user.role)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!invoice) {
    return NextResponse.json({ error: "Facture introuvable." }, { status: 404 });
  }

  const pdf = await renderInvoicePdf(invoice);

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="facture-${invoice.number}.pdf"`,
    },
  });
}
