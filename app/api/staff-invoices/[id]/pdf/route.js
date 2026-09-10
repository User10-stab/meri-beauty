import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessDashboard } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { renderInvoicePdf } from "@/lib/pdf/render";

// PDF rendering uses Node.js APIs (file system, canvas, etc.)
export const runtime = "nodejs";

/**
 * GET /api/staff-invoices/:id/pdf
 *
 * Streams the invoice PDF for any Invoice row generated from a staff contract.
 * The :id is the Invoice.id (not StaffMonthlyInvoice.id).
 * Secured to all dashboard users (OWNER / ADMIN / STAFF).
 */
export async function GET(req, { params }) {
  const session = await auth();
  if (!session?.user || !canAccessDashboard(session.user.role)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 });
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { lines: true },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Facture introuvable." }, { status: 404 });
  }

  try {
    const pdf = await renderInvoicePdf(invoice);
    const filename = `facture-${invoice.number}.pdf`;

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[staff-invoice-pdf] renderInvoicePdf failed", err);
    return NextResponse.json({ error: "Échec de la génération du PDF." }, { status: 500 });
  }
}
