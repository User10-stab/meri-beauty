"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { sendEmail } from "@/lib/email";
import { creditNoteEmail } from "@/lib/email-templates";
import { renderCreditNotePdf } from "@/lib/pdf/render";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";
import { isBelgianVatNumber } from "@/lib/billit";

/**
 * Re-sends an already-issued credit note to the buyer named on the invoice
 * it corrects — CreditNote carries no customer snapshot of its own (see the
 * model comment), so the recipient always comes from creditNote.invoice,
 * exactly like sendInvoiceByEmail reads from Invoice directly. Same
 * reasoning against taking a recipient from the caller: the document names
 * one buyer, and this must never let it be mailed to someone else.
 */
export async function sendCreditNoteByEmail(creditNoteId) {
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

    // A credit note correcting a Belgian B2B invoice falls under the same
    // 2026 structured e-invoicing mandate as the invoice itself — it must
    // travel over Peppol, never as an ad-hoc PDF e-mail. Hard server-side
    // refusal, mirroring sendInvoiceByEmail's own guard.
    if (invoice.customerType === "B2B" && isBelgianVatNumber(invoice.customerVatNumber)) {
      return {
        success: false,
        message: `La note de crédit ${creditNote.number} corrige une facture B2B belge — elle doit être transmise via Billit/Peppol, pas par e-mail direct.`,
      };
    }

    const recipient = invoice.customerEmail?.trim();
    if (!recipient) {
      return {
        success: false,
        message: `La note de crédit ${creditNote.number} ne porte aucune adresse e-mail client. Corrigez la fiche client, puis réessayez.`,
      };
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
      to: recipient,
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

    await writeAuditLog(prisma, {
      action: AUDIT_ACTIONS.CREDIT_NOTE_EMAILED,
      entityType: "CreditNote",
      entityId: creditNote.id,
      metadata: { number: creditNote.number, invoiceNumber: invoice.number, recipient },
      actor: session.user,
    });

    return { success: true, message: `Note de crédit ${creditNote.number} envoyée à ${recipient}.` };
  } catch (error) {
    console.error("[sendCreditNoteByEmail]", error);
    return { success: false, message: "Impossible d'envoyer cette note de crédit." };
  }
}
