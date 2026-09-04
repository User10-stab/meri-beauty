import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canAccessDashboard } from "@/lib/authorization";
import { renderTicketPdf } from "@/lib/pdf/render";
import { formatSalonAddress } from "@/lib/format-address";
import { resolveServiceVatPolicy, calculateVatTotals } from "@/lib/tax-policy";
import { describeReservationPayment } from "@/lib/cash-book/reservation-tickets";

// react-pdf needs Node APIs — not edge-compatible.
export const runtime = "nodejs";

const CUSTOMER_SELECT = { fullName: true, isCompany: true, vatNumber: true, vatValidatedAt: true };

/**
 * Reprint the till-style ticket for a rendez-vous/atelier/événement/formation
 * payment — keyed on the Payment, not the Invoice, because a particulier
 * (the common case — see hasInvoiceableVatIdentity) never gets an Invoice row
 * at all. Before this route, a particulier's ticket only ever existed as a
 * one-shot best-effort e-mail sent inline by settleReservation/
 * completeAppointment — a failed send, or simply wanting a second copy, left
 * staff with nothing to hand over: no invoice (by design) AND no ticket
 * (missing capability, not by design).
 *
 * When an Invoice does exist (a VIES-valid company), its frozen fields are
 * reprinted verbatim — same as sendReservationTicketsForSession's batch. When
 * it doesn't, the ticket is computed straight from the Payment using the
 * exact same VAT policy settleReservation/completeAppointment already apply
 * at settlement time, so the figure shown here always matches what the
 * customer was actually charged.
 *
 * A boutique/POS order keeps its own route (app/api/orders/[id]/ticket) —
 * real per-item line items, and it must work even before any Payment exists.
 */
export async function GET(req, { params }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { id } = await params;

  const payment = await prisma.payment.findUnique({
    where: { id },
    select: {
      totalAmount: true,
      paidAmount: true,
      orderId: true,
      invoice: {
        select: {
          number: true,
          issuedAt: true,
          sellerName: true,
          sellerAddress: true,
          sellerVatNumber: true,
          subtotalExclVat: true,
          vatRate: true,
          vatAmount: true,
          totalInclVat: true,
        },
      },
      appointment: {
        select: {
          userId: true,
          user: { select: CUSTOMER_SELECT },
          staffService: { select: { service: { select: { name: true } } } },
        },
      },
      workshopReservation: {
        select: {
          customerId: true,
          customer: { select: CUSTOMER_SELECT },
          session: { select: { workshop: { select: { title: true, type: true } } } },
        },
      },
      formationReservation: {
        select: {
          customerId: true,
          customer: { select: CUSTOMER_SELECT },
          session: { select: { formation: { select: { title: true } } } },
        },
      },
    },
  });
  if (!payment) {
    return NextResponse.json({ error: "Paiement introuvable." }, { status: 404 });
  }
  if (payment.orderId) {
    return NextResponse.json({ error: "Utilisez le reçu de la commande boutique pour ce paiement." }, { status: 400 });
  }

  const ownerId =
    payment.appointment?.userId ?? payment.workshopReservation?.customerId ?? payment.formationReservation?.customerId ?? null;
  if (!canAccessDashboard(session.user.role)) {
    if (!ownerId || ownerId !== session.user.id) {
      return NextResponse.json({ error: "Non autorisé." }, { status: 403 });
    }
  }

  const description = describeReservationPayment(payment);
  const customer =
    payment.appointment?.user ?? payment.workshopReservation?.customer ?? payment.formationReservation?.customer ?? null;

  let ticketFields;
  if (payment.invoice) {
    const inv = payment.invoice;
    ticketFields = {
      orderNumber: inv.number,
      invoiceNumber: inv.number,
      issuedAt: inv.issuedAt,
      sellerName: inv.sellerName,
      sellerAddress: inv.sellerAddress,
      sellerVatNumber: inv.sellerVatNumber,
      subtotalExclVat: inv.subtotalExclVat,
      vatRate: inv.vatRate,
      vatAmount: inv.vatAmount,
      totalInclVat: inv.totalInclVat,
    };
  } else {
    const salon = await prisma.salon.findUnique({
      where: { id: "main-salon" },
      select: { legalName: true, vatNumber: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, countryCode: true },
    });
    const { vatRate } = resolveServiceVatPolicy({ customer });
    // A ticket proves what has actually been collected. For a deposit,
    // totalAmount is the full reservation price while paidAmount is the
    // smaller amount received now. Once the balance is collected,
    // paidAmount naturally becomes the complete amount.
    const { totalExclVat, vatAmount, totalInclVat } = calculateVatTotals(payment.paidAmount, vatRate);
    ticketFields = {
      orderNumber: id,
      issuedAt: new Date(),
      sellerName: salon?.legalName || "Meri Beauty",
      sellerAddress: formatSalonAddress(salon),
      sellerVatNumber: salon?.vatNumber ?? null,
      subtotalExclVat: totalExclVat,
      vatRate,
      vatAmount,
      totalInclVat,
    };
  }

  const pdf = await renderTicketPdf({
    ...ticketFields,
    lines: [{ description, quantity: 1, unitPrice: Number(ticketFields.totalInclVat) }],
  });

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="ticket-${payment.invoice?.number ?? id}.pdf"`,
    },
  });
}
