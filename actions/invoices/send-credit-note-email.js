"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { sendEmail } from "@/lib/email";
import { creditNoteEmail } from "@/lib/email-templates";
import { renderCreditNotePdf } from "@/lib/pdf/render";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";

/**
 * Re-sends an already-issued credit note to the buyer named on the invoice
 * it corrects — CreditNote carries no customer snapshot of its own (see the
 * model comment), so the recipient always comes from creditNote.invoice,
 * exactly like sendInvoiceByEmail reads from Invoice directly. Same rule on
 * the caller: it may add extra internal recipients (`extraRecipients`) from
 * the managed address book and may omit the client's own copy
 * (`includeClient: false`), but can never substitute the client's address.
 */
export async function sendCreditNoteByEmail(creditNoteId, { extraRecipients = [], includeClient = true } = {}) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Non autorisé." };
  }
  if (typeof creditNoteId !== "string" || !creditNoteId) {
    return { success: false, message: "Note de crédit introuvable." };
  }

  try {
    const creditNote = await prisma.creditNote.findUnique({
      where: { id: creditNoteId },
      include: { invoice: { include: { lines: true } } },
    });
    if (!creditNote) return { success: false, message: "Note de crédit introuvable." };

    const invoice = creditNote.invoice;

    const clientEmail = invoice.customerEmail?.trim();
    if (includeClient && !clientEmail) {
      return {
        success: false,
        message: `La note de crédit ${creditNote.number} ne porte aucune adresse e-mail client. Corrigez la fiche client, puis réessayez.`,
      };
    }

    // De-dupe case-insensitively; the client's own address (when included) is
    // authoritative and can't be dropped by a colliding extra recipient.
    const recipientSet = new Set();
    if (includeClient && clientEmail) recipientSet.add(clientEmail);
    for (const email of Array.isArray(extraRecipients) ? extraRecipients : []) {
      if (typeof email === "string" && email.trim()) recipientSet.add(email.trim().toLowerCase());
    }
    const recipients = Array.from(recipientSet);
    if (recipients.length === 0) {
      return { success: false, message: "Aucun destinataire sélectionné pour l'envoi par e-mail." };
    }

    const pdf = await renderCreditNotePdf(creditNote, invoice);

    const { subject, text, html } = creditNoteEmail({
      customerName: invoice.customerName,
      creditNoteNumber: creditNote.number,
      invoiceNumber: invoice.number,
      issuedAt: creditNote.issuedAt ?? new Date(),
      totalInclVat: Number(creditNote.totalInclVat),
      sellerName: invoice.sellerName || "Meri Beauty",
    });

    const result = await sendEmail({
      to: recipients,
      subject,
      text,
      html,
      attachments: [{ filename: `note-de-credit-${creditNote.number}.pdf`, content: pdf }],
    });

    // sendEmail resolves with { success: false } on a provider failure rather
    // than throwing, so a silent "sent" here would be a lie.
    if (result && result.success === false) {
      return { success: false, message: `L'envoi a échoué : ${result.error ?? "erreur du fournisseur e-mail"}.` };
    }

    await prisma.creditNote.update({
      where: { id: creditNote.id },
      data: { emailSentAt: new Date() },
    });

    await writeAuditLog(prisma, {
      action: AUDIT_ACTIONS.CREDIT_NOTE_EMAILED,
      entityType: "CreditNote",
      entityId: creditNote.id,
      metadata: { number: creditNote.number, invoiceNumber: invoice.number, recipients },
      actor: session.user,
    });

    return { success: true, message: `Note de crédit ${creditNote.number} envoyée à ${recipients.join(", ")}.` };
  } catch (error) {
    console.error("[sendCreditNoteByEmail]", error);
    return { success: false, message: "Impossible d'envoyer cette note de crédit." };
  }
}
