import { isTillCashOperator } from "@/lib/authorization";
import { sendTicketByEmail } from "@/actions/payments/send-ticket-email";
import { buildPaymentTicket } from "@/lib/cash-book/build-payment-ticket";
import { sendEmail } from "@/lib/email";
import { paymentConfirmedEmail } from "@/lib/email-templates";
import { prisma } from "@/lib/prisma";

/**
 * The client e-mail that follows a collected balance (appointment, atelier,
 * formation), chosen by WHO collected it and WHOSE sale it is.
 *
 *   - The salon (admin, or Marie Mercier — isTillCashOperator, never a role
 *     test) collecting the salon's own sale: the ticket, through
 *     sendTicketByEmail.
 *   - Anyone else, or an independent's sale (Payment.payeeStaffId) whoever
 *     collected it: a plain paymentConfirmedEmail. The salon issues no ticket
 *     for an independent's sale, so the client is simply told the payment
 *     went through.
 *
 * Deliberately not "use server": this is called from inside server actions
 * with the actor they already authenticated, and must not become a public
 * endpoint that e-mails a client on an arbitrary caller's say-so.
 *
 * Never throws — callers fire and forget it after the settlement committed.
 *
 * @param {{ role?: string, email?: string }} actor
 * @param {string} paymentId
 * @param {{ transactionId?: string|null }} [options]
 */
export async function sendSettlementEmail(actor, paymentId, { transactionId = null } = {}) {
  // The salon's ticket only for the salon's sale: an independent's payment
  // gets the plain confirmation even when the admin or Marie collected it.
  let owner;
  try {
    owner = await prisma.payment.findUnique({ where: { id: paymentId }, select: { payeeStaffId: true } });
  } catch (error) {
    console.error("[sendSettlementEmail]", error);
    return { success: false, message: "Impossible d'envoyer la confirmation de paiement." };
  }
  if (isTillCashOperator(actor) && !owner?.payeeStaffId) return sendTicketByEmail(paymentId, { transactionId });

  try {
    // Reused only for what it resolves — the client, the leg's amount and
    // date, and the prestation's label.
    const result = await buildPaymentTicket(paymentId, { transactionId });
    if (result.error) return { success: false, message: result.error.message };

    const { ticket, customer } = result;
    const recipient = customer?.email?.trim();
    if (!recipient) return { success: false, message: "Ce client n'a aucune adresse e-mail enregistrée." };

    const sendResult = await sendEmail({
      to: recipient,
      ...paymentConfirmedEmail({
        customerName: customer.fullName,
        description: ticket.lines?.[0]?.description ?? "votre prestation",
        amount: Number(ticket.totalInclVat),
        paidAt: ticket.issuedAt,
      }),
    });
    if (sendResult && sendResult.success === false) {
      return { success: false, message: `L'envoi a échoué : ${sendResult.error ?? "erreur du fournisseur e-mail"}.` };
    }
    return { success: true, message: `Confirmation de paiement envoyée à ${recipient}.` };
  } catch (error) {
    console.error("[sendSettlementEmail]", error);
    return { success: false, message: "Impossible d'envoyer la confirmation de paiement." };
  }
}
