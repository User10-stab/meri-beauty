import { prisma } from "@/lib/prisma";
import { formatSalonAddress } from "@/lib/format-address";
import { resolveServiceVatPolicy } from "@/lib/tax-policy";
import { collectionTicketFields, consolidatedTicketFields } from "@/lib/cash-book/ticket-identity";
import { describeReservationPayment } from "@/lib/cash-book/reservation-tickets";

// email is unused by the PDF itself but is what send-ticket-email.js needs
// the recipient address from — kept on this one shared select rather than a
// second lookup, since it's already the customer this ticket belongs to.
const CUSTOMER_SELECT = { fullName: true, email: true, isCompany: true, vatNumber: true, vatValidatedAt: true };

/**
 * Assembles the till-style ticket for a rendez-vous/atelier/événement/formation
 * payment — the same fields app/api/payments/[id]/ticket renders to a PDF for
 * staff reprint, and actions/payments/send-ticket-email.js e-mails to the
 * client under the SEND_TICKET_EMAIL permission. Extracted so both stay in
 * sync with exactly one source of "what a ticket for this payment looks
 * like" — see that route's own doc comment for why a Payment, not an
 * Invoice, is the ticket's identity.
 *
 * Returns `{ ticket, customer }` on success, or `{ error: { status,
 * message } }` on a lookup/shape failure the caller should surface as-is
 * (a 404/400 from a route, or a plain user-facing message from a server
 * action).
 */
export async function buildPaymentTicket(paymentId, { transactionId = null } = {}) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
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
    return { error: { status: 404, message: "Paiement introuvable." } };
  }
  if (payment.orderId) {
    return { error: { status: 400, message: "Utilisez le reçu de la commande boutique pour ce paiement." } };
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

  let ticket;
  if (transactionId) {
    // Explicit "give me just this leg" — the acompte slip on its own, say.
    const txn = payment.transactions.find((item) => item.id === transactionId);
    if (!txn) {
      return { error: { status: 404, message: "Aucun encaissement correspondant à ce ticket." } };
    }
    const receipt = collectionTicketFields(txn, payment.invoice, ticketFields.vatRate);
    ticket = { ...ticketFields, ...receipt, lines: [{ description, quantity: 1, unitPrice: receipt.totalInclVat }] };
  } else {
    // One consolidated receipt for the whole payment, however many legs it took
    // (acompte online + solde au comptoir). The per-leg split is the `payments`
    // block; the single line carries the full prestation price.
    if (!payment.transactions.length) {
      return { error: { status: 404, message: "Aucun encaissement correspondant à ce ticket." } };
    }
    const receipt = consolidatedTicketFields(paymentId, payment.transactions, payment.invoice, ticketFields.vatRate);
    ticket = { ...ticketFields, ...receipt, lines: [{ description, quantity: 1, unitPrice: receipt.totalInclVat }] };
  }

  return { ticket, customer };
}
