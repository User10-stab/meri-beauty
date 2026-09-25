import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { ticketEmail } from "@/lib/email-templates";
import { renderTicketPdf } from "@/lib/pdf/render";
import { buildPaymentTicket } from "@/lib/cash-book/build-payment-ticket";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";

/**
 * E-mails a payment's salon ticket to the client it belongs to. No auth of
 * its own: callers decide who may. sendTicketByEmail (the manual button,
 * canSendTicketEmail) and sendSettlementEmail (right after a till user
 * collected the salon's own sale, canUseSalonTill) are the only two.
 *
 * Deliberately a plain module, not a server action — it must never become a
 * public endpoint.
 *
 * @param {string} paymentId
 * @param {{ transactionId?: string|null, actor: { id: string } }} options
 */
export async function emailPaymentTicket(paymentId, { transactionId = null, actor }) {
  if (typeof paymentId !== "string" || !paymentId) {
    return { success: false, message: "Paiement introuvable." };
  }

  try {
    const result = await buildPaymentTicket(paymentId, { transactionId });
    if (result.error) {
      return { success: false, message: result.error.message };
    }

    const { ticket, customer } = result;

    // No number, no ticket to send. Since 16/09/2026 a sale collected by an
    // independent allocates none at all (lib/tickets/allocate-ticket-number.js)
    // — it is her sale, under her own VAT number, and the salon has nothing
    // to put in the client's inbox on its behalf. The same guard covers the
    // sales settled before ticket numbering shipped, which would otherwise
    // go out titled "Votre ticket null" with a "null.pdf" attached. The
    // document itself stays reprintable from app/api/payments/[id]/ticket,
    // which names the file after the payment when there is no number.
    if (!ticket.ticketNumber) {
      return {
        success: false,
        message: "Ce paiement n'a pas de numéro de ticket — aucun ticket au nom du salon ne peut être envoyé pour cette vente.",
      };
    }

    const recipient = customer?.email?.trim();
    if (!recipient) {
      return {
        success: false,
        message: "Ce client n'a aucune adresse e-mail enregistrée. Corrigez sa fiche, puis réessayez.",
      };
    }

    const pdf = await renderTicketPdf(ticket);

    const { subject, text, html } = ticketEmail({
      customerName: customer.fullName,
      ticketNumber: ticket.ticketNumber,
      issuedAt: ticket.issuedAt,
      lines: ticket.lines,
      subtotalExclVat: Number(ticket.subtotalExclVat),
      vatRate: Number(ticket.vatRate),
      vatAmount: Number(ticket.vatAmount),
      totalInclVat: Number(ticket.totalInclVat),
      sellerName: ticket.sellerName || "Meri Beauty",
    });

    const sendResult = await sendEmail({
      to: recipient,
      subject,
      text,
      html,
      attachments: [{ filename: `${ticket.ticketNumber}.pdf`, content: pdf }],
    });

    // sendEmail resolves with { success: false } on a provider failure rather
    // than throwing, so a silent "sent" here would be a lie.
    if (sendResult && sendResult.success === false) {
      return { success: false, message: `L'envoi a échoué : ${sendResult.error ?? "erreur du fournisseur e-mail"}.` };
    }

    await prisma.payment.update({
      where: { id: paymentId },
      data: { ticketEmailedAt: new Date() },
    });

    await writeAuditLog(prisma, {
      action: AUDIT_ACTIONS.TICKET_EMAILED,
      entityType: "Payment",
      entityId: paymentId,
      metadata: { ticketNumber: ticket.ticketNumber, recipient, transactionId },
      actor,
    });

    return { success: true, message: `Ticket envoyé à ${recipient}.` };
  } catch (error) {
    console.error("[emailPaymentTicket]", error);
    return { success: false, message: "Impossible d'envoyer ce ticket." };
  }
}
