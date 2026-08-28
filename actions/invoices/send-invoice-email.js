"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { sendEmail } from "@/lib/email";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";
import { isBelgianVatNumber } from "@/lib/billit";

/**
 * Re-sends an already-issued invoice to the customer it was issued to.
 *
 * Deliberately NOT taking a recipient address from the caller: the invoice
 * carries the buyer identity it was legally issued under (`customerEmail`),
 * and letting the dashboard retype it would allow a document naming one
 * person to be mailed to another — which is exactly the kind of thing an
 * audit is supposed to be able to rule out. If the address is wrong, the
 * customer record is what needs fixing, not this call.
 *
 * The PDF is re-rendered from the stored invoice rather than cached, so a
 * re-send always reflects the document as it legally stands — including the
 * art. 226(8) net columns backfilled onto invoices issued before they
 * existed.
 */
export async function sendInvoiceByEmail(invoiceId) {
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

    // A Belgian company invoice must travel over Peppol, never as an ad-hoc
    // PDF e-mail (Belgium's 2026 structured e-invoicing mandate) — this is
    // a hard server-side refusal, not just a disabled button, since this
    // action can be called directly and this rule must hold either way.
    if (invoice.customerType === "B2B" && isBelgianVatNumber(invoice.customerVatNumber)) {
      return {
        success: false,
        message: `La facture ${invoice.number} est une facture B2B belge — elle doit être transmise via Billit/Peppol, pas par e-mail direct.`,
      };
    }

    const recipient = invoice.customerEmail?.trim();
    if (!recipient) {
      return {
        success: false,
        message: `La facture ${invoice.number} ne porte aucune adresse e-mail client. Corrigez la fiche client, puis réémettez.`,
      };
    }

    const pdf = await renderInvoicePdf(invoice);

    const result = await sendEmail({
      to: recipient,
      subject: `Votre facture ${invoice.number} — Meri Beauty`,
      text:
        `Bonjour ${invoice.customerName},\n\n` +
        `Vous trouverez ci-joint votre facture ${invoice.number}.\n\n` +
        `L'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${invoice.customerName},</p>` +
        `<p>Vous trouverez ci-joint votre facture <strong>${invoice.number}</strong>.</p>` +
        `<p>L'équipe Meri Beauty</p>`,
      attachments: [{ filename: `facture-${invoice.number}.pdf`, content: pdf }],
    });

    // sendEmail resolves with { success: false } on a provider failure rather
    // than throwing, so a silent "sent" here would be a lie.
    if (result && result.success === false) {
      return { success: false, message: `L'envoi a échoué : ${result.error ?? "erreur du fournisseur e-mail"}.` };
    }

    await writeAuditLog(prisma, {
      action: AUDIT_ACTIONS.INVOICE_EMAILED,
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { number: invoice.number, recipient },
      actor: session.user,
    });

    return { success: true, message: `Facture ${invoice.number} envoyée à ${recipient}.` };
  } catch (error) {
    console.error("[sendInvoiceByEmail]", error);
    return { success: false, message: "Impossible d'envoyer cette facture." };
  }
}
