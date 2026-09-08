import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canAccessDashboard } from "@/lib/authorization";
import { renderTicketPdf } from "@/lib/pdf/render";
import { formatSalonAddress } from "@/lib/format-address";
import { resolveServiceVatPolicy } from "@/lib/tax-policy";
import { collectionTicketFields, consolidatedTicketFields } from "@/lib/cash-book/ticket-identity";
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
 * By default this returns ONE consolidated receipt for the whole payment
 * (identity T-<paymentId>, full prestation amount, a per-leg acompte/solde
 * breakdown) — a customer who paid in two steps gets one coherent document,
 * not two separately-numbered half-receipts. `?transactionId=<id>` still
 * returns a single leg on its own (identity T-<transactionId>), for the rare
 * case staff need just the acompte slip.
 *
 * An invoice supplies its seller/VAT policy and a separate reference, never
 * the ticket's identity. Without an invoice, use the service VAT policy.
 * No recorded collection means no payment receipt.
 *
 * A boutique/POS order keeps its own route (app/api/orders/[id]/ticket) —
 * real per-item line items, and it must work even before any Payment exists.
 *
 * Staff/dashboard access only — no client self-service download. Neither
 * settleReservation nor completeAppointment auto-e-mail this ticket to the
 * customer any more.
 */
export async function GET(req, { params }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { id } = await params;

  if (!canAccessDashboard(session.user.role)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 403 });
  }

  const payment = await prisma.payment.findUnique({
    where: { id },
    select: {
      totalAmount: true,
      paidAmount: true,
      orderId: true,
      transactions: {
        where: { isDeleted: false, transactionType: { in: ["DEPOSIT", "FINAL_PAYMENT"] }, amount: { gt: 0 } },
        orderBy: [{ paidAt: "asc" }, { id: "asc" }],
      },
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
          user: { select: CUSTOMER_SELECT },
          staffService: { select: { service: { select: { name: true } } } },
        },
      },
      workshopReservation: {
        select: {
          customer: { select: CUSTOMER_SELECT },
          session: { select: { workshop: { select: { title: true, type: true } } } },
        },
      },
      formationReservation: {
        select: {
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

  const description = describeReservationPayment(payment);
  const customer =
    payment.appointment?.user ?? payment.workshopReservation?.customer ?? payment.formationReservation?.customer ?? null;

  let ticketFields;
  if (payment.invoice) {
    const inv = payment.invoice;
    ticketFields = {
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
    // Amounts and original dates come from each collection below, not the
    // mutable aggregate paidAmount or the full reservation price.
    ticketFields = {
      sellerName: salon?.legalName || "Meri Beauty",
      sellerAddress: formatSalonAddress(salon),
      sellerVatNumber: salon?.vatNumber ?? null,
      vatRate,
    };
  }

  const transactionId = new URL(req.url).searchParams.get("transactionId");

  let ticket;
  if (transactionId) {
    // Explicit "give me just this leg" — the acompte slip on its own, say.
    const txn = payment.transactions.find((item) => item.id === transactionId);
    if (!txn) {
      return NextResponse.json({ error: "Aucun encaissement correspondant à ce ticket." }, { status: 404 });
    }
    const receipt = collectionTicketFields(txn, payment.invoice, ticketFields.vatRate);
    ticket = { ...ticketFields, ...receipt, lines: [{ description, quantity: 1, unitPrice: receipt.totalInclVat }] };
  } else {
    // One consolidated receipt for the whole payment, however many legs it took
    // (acompte online + solde au comptoir). The per-leg split is the `payments`
    // block; the single line carries the full prestation price.
    if (!payment.transactions.length) {
      return NextResponse.json({ error: "Aucun encaissement correspondant à ce ticket." }, { status: 404 });
    }
    const receipt = consolidatedTicketFields(id, payment.transactions, payment.invoice, ticketFields.vatRate);
    ticket = { ...ticketFields, ...receipt, lines: [{ description, quantity: 1, unitPrice: receipt.totalInclVat }] };
  }

  const pdf = await renderTicketPdf(ticket);

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ticket.ticketNumber}.pdf"`,
    },
  });
}
