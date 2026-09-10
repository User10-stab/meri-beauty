import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { renderTicketPdf } from "@/lib/pdf/render";
import { buildPaymentTicket } from "@/lib/cash-book/build-payment-ticket";

// react-pdf needs Node APIs — not edge-compatible.
export const runtime = "nodejs";

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
 * Gated on the same STAFF_PERMISSIONS.SEND_TICKET_EMAIL permission as
 * actions/payments/send-ticket-email.js, which shares this route's ticket
 * assembly (lib/cash-book/build-payment-ticket.js) — a staff member who
 * isn't allowed to put a reservation ticket in a client's inbox shouldn't be
 * able to generate/download the same document another way either. No client
 * self-service download.
 */
export async function GET(req, { params }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { id } = await params;

  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.SEND_TICKET_EMAIL))) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 403 });
  }

  const transactionId = new URL(req.url).searchParams.get("transactionId");
  const result = await buildPaymentTicket(id, { transactionId });
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: result.error.status });
  }

  const { ticket } = result;
  const pdf = await renderTicketPdf(ticket);

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ticket.ticketNumber}.pdf"`,
    },
  });
}
