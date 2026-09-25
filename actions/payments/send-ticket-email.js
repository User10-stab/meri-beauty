"use server";

import { auth } from "@/auth";
import { canSendTicketEmail } from "@/lib/authorization";
import { emailPaymentTicket } from "@/lib/tickets/email-payment-ticket";

/**
 * Manually e-mails an already-generated ticket to the client it belongs to.
 *
 * The automatic ticket after a collected balance goes through
 * sendSettlementEmail instead (lib/payments/send-settlement-email.js), which
 * calls the same emailPaymentTicket for the salon's own sale when the
 * collector may run the till (canUseSalonTill). Reprinting the same document via
 * app/api/payments/[id]/ticket requires this same check, not just any
 * dashboard role — a staff member who can't put a ticket in a client's inbox
 * can't generate it another way either. Only the salon's own accounts pass:
 * admin/owner, plus Marie Mercier, whose VAT number is the salon's despite
 * her STAFF role — see canSendTicketEmail in lib/authorization.js.
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
  if (!(await canSendTicketEmail(session.user))) {
    return { success: false, message: "Non autorisé." };
  }
  return emailPaymentTicket(paymentId, { transactionId, actor: session.user });
}
