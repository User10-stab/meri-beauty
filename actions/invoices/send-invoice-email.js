"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { sendEmail } from "@/lib/email";
import { invoiceEmail } from "@/lib/email-templates";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";

/**
 * Re-sends an already-issued invoice to the customer it was issued to.
 *
 * The caller can never *retype* the buyer's address — it always comes from
 * the invoice (`customerEmail`), so a document naming one person can't be
 * mailed to someone else, which an audit is meant to rule out. What the
 * caller may do (Operations delivery dialog): add extra internal recipients
 * from the managed address book (`extraRecipients`), and optionally omit the
 * client's own copy (`includeClient: false`) when only the internal copies
 * are wanted. The client's address itself is never substituted.
 *
 * The PDF is re-rendered from the stored invoice rather than cached, so a
 * re-send always reflects the document as it legally stands — including the
 * art. 226(8) net columns backfilled onto invoices issued before they
 * existed.
 */
export async function sendInvoiceByEmail(invoiceId, { extraRecipients = [], includeClient = true } = {}) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Non autorisé." };
  }
  if (typeof invoiceId !== "string" || !invoiceId) {
    return { success: false, message: "Facture introuvable." };
  }

  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lines: true,
        payment: { select: { paidAt: true, transactionReference: true } },
      },
    });
    if (!invoice) return { success: false, message: "Facture introuvable." };

    const clientEmail = invoice.customerEmail?.trim();
    if (includeClient && !clientEmail) {
      return {
        success: false,
        message: `La facture ${invoice.number} ne porte aucune adresse e-mail client. Corrigez la fiche client, puis réémettez.`,
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

    const pdf = await renderInvoicePdf(invoice);

    const { subject, text, html } = invoiceEmail({
      customerName: invoice.customerName,
      invoiceNumber: invoice.number,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate ?? null,
      lines: invoice.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: Number(l.unitPrice),
        lineTotal: Number(l.lineTotal),
      })),
      subtotalExclVat: Number(invoice.subtotalExclVat),
      vatRate: Number(invoice.vatRate),
      vatAmount: Number(invoice.vatAmount),
      totalInclVat: Number(invoice.totalInclVat),
      sellerName: invoice.sellerName || "Meri Beauty",
    });

    const result = await sendEmail({
      to: recipients,
      subject,
      text,
      html,
      attachments: [{ filename: `facture-${invoice.number}.pdf`, content: pdf }],
    });

    // sendEmail resolves with { success: false } on a provider failure rather
    // than throwing, so a silent "sent" here would be a lie.
    if (result && result.success === false) {
      return { success: false, message: `L'envoi a échoué : ${result.error ?? "erreur du fournisseur e-mail"}.` };
    }

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { emailSentAt: new Date() },
    });

    await writeAuditLog(prisma, {
      action: AUDIT_ACTIONS.INVOICE_EMAILED,
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { number: invoice.number, recipients },
      actor: session.user,
    });

    return { success: true, message: `Facture ${invoice.number} envoyée à ${recipients.join(", ")}.` };
  } catch (error) {
    console.error("[sendInvoiceByEmail]", error);
    return { success: false, message: "Impossible d'envoyer cette facture." };
  }
}
