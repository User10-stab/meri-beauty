import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canAccessDashboard } from "@/lib/authorization";
import { renderTicketPdf } from "@/lib/pdf/render";
import { formatSalonAddress } from "@/lib/format-address";

// react-pdf needs Node APIs — not edge-compatible.
export const runtime = "nodejs";

/**
 * Reprint a counter receipt.
 *
 * completePointOfSaleSale renders a walk-in ticket once and hands it straight
 * back as base64 — nothing persists it, so a customer coming back an hour
 * later for a paper copy, or a cashier whose print dialog was dismissed, had
 * nothing to reprint. Everything the ticket shows already lives on the Order,
 * so this re-renders it on demand rather than storing a blob.
 *
 * A ticket is not an invoice: it carries no customer identity. A named sale
 * has a real Invoice and should be reprinted from /api/invoices/[id]/pdf —
 * this stays available for it anyway, since a customer at the till usually
 * just wants the slip.
 *
 * Dashboard roles only. A ticket names no customer, so there is no ownership
 * to check and nothing a customer could legitimately fetch here.
 */
export async function GET(req, { params }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  if (!canAccessDashboard(session.user.role)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 403 });
  }

  const { id } = await params;

  const [order, salon] = await Promise.all([
    prisma.order.findUnique({
      where: { id },
      select: {
        orderNumber: true,
        createdAt: true,
        totalExclVat: true,
        vatRate: true,
        totalVat: true,
        totalAmount: true,
        items: { select: { productName: true, quantity: true, unitPrice: true } },
      },
    }),
    prisma.salon.findUnique({
      where: { id: "main-salon" },
      select: {
        legalName: true,
        vatNumber: true,
        addressLine1: true,
        addressLine2: true,
        postalCode: true,
        city: true,
        countryCode: true,
      },
    }),
  ]);

  if (!order) {
    return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
  }

  const pdf = await renderTicketPdf({
    orderNumber: order.orderNumber,
    issuedAt: order.createdAt,
    sellerName: salon?.legalName || "Meri Beauty",
    sellerAddress: formatSalonAddress(salon),
    sellerVatNumber: salon?.vatNumber ?? null,
    subtotalExclVat: order.totalExclVat,
    vatRate: order.vatRate,
    vatAmount: order.totalVat,
    totalInclVat: order.totalAmount,
    lines: order.items.map((item) => ({
      description: item.productName,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
    })),
  });

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      // inline so the browser's print dialog opens straight from the tab —
      // the cashier is standing at the counter, not filing a download.
      "Content-Disposition": `inline; filename="recu-${order.orderNumber}.pdf"`,
    },
  });
}
