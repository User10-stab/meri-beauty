import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { renderRefundReceiptPdf } from "@/lib/pdf/render";
import { isBusinessRefundCustomer } from "@/lib/refunds/document-policy";

export const runtime = "nodejs";

export async function GET(_request, { params }) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { id } = await params;
  const operation = await prisma.refundOperation.findUnique({
    where: { id },
    include: {
      legs: true,
      payment: {
        select: {
          appointment: { select: { user: { select: { fullName: true, email: true, isCompany: true, vatNumber: true } } } },
          workshopReservation: {
            select: {
              customer: { select: { fullName: true, email: true, isCompany: true, vatNumber: true } },
              session: { select: { workshop: { select: { title: true } } } },
            },
          },
          formationReservation: {
            select: {
              customer: { select: { fullName: true, email: true, isCompany: true, vatNumber: true } },
              session: { select: { formation: { select: { title: true } } } },
            },
          },
          order: { select: { orderNumber: true, user: { select: { fullName: true, email: true, isCompany: true, vatNumber: true } } } },
        },
      },
    },
  });
  if (!operation?.refundReceiptNumber) return NextResponse.json({ error: "Justificatif introuvable." }, { status: 404 });
  if (operation.status !== "COMPLETED") {
    return NextResponse.json({ error: "Le remboursement doit être entièrement confirmé avant son justificatif." }, { status: 409 });
  }

  const customer = operation.payment.appointment?.user ?? operation.payment.workshopReservation?.customer ?? operation.payment.formationReservation?.customer ?? operation.payment.order?.user ?? null;
  if (isBusinessRefundCustomer(customer)) {
    return NextResponse.json({ error: "Un client B2B doit recevoir une note de crédit, jamais un justificatif B2C." }, { status: 409 });
  }
  const itemLabel = operation.payment.order
    ? `Commande n°${operation.payment.order.orderNumber}`
    : operation.payment.workshopReservation?.session?.workshop?.title ?? operation.payment.formationReservation?.session?.formation?.title ?? "Prestation Meri Beauty";
  const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { name: true, legalName: true, address: true, vatNumber: true } });
  const pdf = await renderRefundReceiptPdf(operation, {
    number: operation.refundReceiptNumber,
    issuedAt: operation.createdAt,
    sellerName: salon?.legalName ?? salon?.name ?? "Meri Beauty",
    sellerAddress: salon?.address ?? null,
    sellerVatNumber: salon?.vatNumber ?? null,
    customerName: customer?.fullName ?? "Client",
    customerEmail: customer?.email ?? null,
    itemLabel,
    reason: operation.reason,
  });

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename=justificatif-remboursement-${operation.refundReceiptNumber}.pdf`,
    },
  });
}
