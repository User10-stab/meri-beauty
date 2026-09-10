"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { STAFF_PERMISSIONS, hasDashboardPermission } from "@/lib/authorization";
import { sendEmail } from "@/lib/email";
import { ticketEmail } from "@/lib/email-templates";
import { renderTicketPdf } from "@/lib/pdf/render";
import { buildPaymentTicket } from "@/lib/cash-book/build-payment-ticket";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";

/**
 * Manually e-mails an already-generated ticket to the client it belongs to.
 *
 * completeAppointment/settleReservation also fire this automatically once a
 * balance is actually collected, but only when the settling staff member
 * holds STAFF_PERMISSIONS.SEND_TICKET_EMAIL — this action re-derives auth()
 * and checks the permission itself, so that fire-and-forget call is gated
 * exactly the same way a manual click is. Reprinting the same document via
 * app/api/payments/[id]/ticket requires this same permission, not just any
 * dashboard role — a staff member who can't put a ticket in a client's inbox
 * can't generate it another way either. Admin/owner roles pass
 * hasDashboardPermission automatically, same as every other STAFF_PERMISSIONS
 * check.
 *
 * Deliberately NOT taking a recipient address from the caller, for the same
 * reason sendInvoiceByEmail doesn't: the address comes from the reservation's
 * own customer record, never from a value the dashboard could retype.
 */
export async function sendTicketByEmail(paymentId, { transactionId = null } = {}) {
  const session = await auth();
  if (!session?.user) {
    return { success: false, message: "Non autorisé." };
  }
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.SEND_TICKET_EMAIL))) {
    return { success: false, message: "Non autorisé." };
  }
  if (typeof paymentId !== "string" || !paymentId) {
    return { success: false, message: "Paiement introuvable." };
  }

  try {
    const result = await buildPaymentTicket(paymentId, { transactionId });
    if (result.error) {
      return { success: false, message: result.error.message };
    }

    const { ticket, customer } = result;
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
      actor: session.user,
    });

    return { success: true, message: `Ticket envoyé à ${recipient}.` };
  } catch (error) {
    console.error("[sendTicketByEmail]", error);
    return { success: false, message: "Impossible d'envoyer ce ticket." };
  }
}
