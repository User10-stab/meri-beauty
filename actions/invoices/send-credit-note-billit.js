"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import { renderCreditNotePdf } from "@/lib/pdf/render";
import { createBillitOrder, parsePeppolIdentifier, isBelgianVatNumber } from "@/lib/billit";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";

/**
 * Creates this credit note as a CreditNote-type order in Billit — same
 * create-order-only contract as sendInvoiceToBillit (POST /v1/orders only,
 * see lib/billit.js for why): staff finish the actual Peppol/e-mail dispatch
 * from inside Billit's own dashboard.
 *
 * Scoped to the same Belgian-B2B-only case as the invoice it corrects — a
 * credit note against a Belgian B2B invoice falls under the same 2026
 * structured e-invoicing mandate. E-mail remains a separate deliberate
 * delivery choice; this action is only the Belgian Billit/Peppol handoff.
 * A B2C or foreign-VAT credit note has nowhere sensible to route on Billit.
 */
export async function sendCreditNoteToBillit(creditNoteId) {
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
      include: {
        invoice: {
          include: {
            lines: true,
            payment: {
              select: {
                order: { select: { userId: true } },
                appointment: { select: { userId: true } },
                workshopReservation: { select: { customerId: true } },
                formationReservation: { select: { customerId: true } },
              },
            },
          },
        },
      },
    });
    if (!creditNote) return { success: false, message: "Note de crédit introuvable." };

    const invoice = creditNote.invoice;

    if (invoice.customerType !== "B2B") {
      return { success: false, message: "Seules les notes de crédit sur facture B2B peuvent être envoyées via Billit." };
    }
    if (!isBelgianVatNumber(invoice.customerVatNumber)) {
      return { success: false, message: "Billit est réservé aux clients avec un numéro de TVA belge (BE…)." };
    }

    const buyerUserId =
      invoice.payment?.order?.userId ??
      invoice.payment?.appointment?.userId ??
      invoice.payment?.workshopReservation?.customerId ??
      invoice.payment?.formationReservation?.customerId ??
      null;

    let peppolRaw = null;
    if (buyerUserId) {
      const billingProfile = await prisma.billingProfile.findUnique({
        where: { userId: buyerUserId },
        select: { peppolParticipantId: true },
      });
      peppolRaw = billingProfile?.peppolParticipantId?.trim() || null;
    }
    const identifier = peppolRaw ? parsePeppolIdentifier(peppolRaw) : null;

    const pdf = await renderCreditNotePdf(creditNote, invoice);
    const isoDate = creditNote.issuedAt.toISOString().slice(0, 10);
    const buyerName = invoice.customerLegalName || invoice.customerName;

    const payload = {
      OrderType: "CreditNote",
      OrderDirection: "Income",
      OrderNumber: creditNote.number,
      OrderDate: isoDate,
      ExpiryDate: isoDate,
      // Ties the correction back to the original invoice inside Billit —
      // same field name Billit's own manual credit-note flow uses.
      RelatedInvoiceNumber: invoice.number,
      Customer: {
        Name: buyerName,
        ...(invoice.customerVatNumber ? { VATNumber: invoice.customerVatNumber } : {}),
        PartyType: "Customer",
        Email: invoice.customerEmail,
        ...(invoice.customerAddress
          ? {
              Addresses: [
                {
                  AddressType: "InvoiceAddress",
                  Name: buyerName,
                  Street: invoice.customerAddress,
                  CountryCode: invoice.taxCountryCode || "BE",
                },
              ],
            }
          : {}),
      },
      OrderLines: [
        {
          Quantity: 1,
          UnitPriceExcl: Number(creditNote.subtotalExclVat),
          Description: creditNote.reason?.trim() || `Note de crédit relative à la facture ${invoice.number}`,
          VATPercentage: Number(creditNote.vatRate),
        },
      ],
      OrderPDF: {
        FileName: `note-de-credit-${creditNote.number}.pdf`,
        FileContent: pdf.toString("base64"),
      },
      ...(identifier
        ? {
            ReceiverEndpointID: identifier,
            ElectronicInvoicing: { PreferredIdentifier: peppolRaw },
            electronicInvoicing: { preferredIdentifier: peppolRaw },
          }
        : {}),
    };

    const result = await createBillitOrder(payload);
    if (!result.success) {
      return { success: false, message: result.message ?? "Échec de l'envoi vers Billit." };
    }

    await prisma.creditNote.update({
      where: { id: creditNote.id },
      data: {
        billitOrderId: result.orderId != null ? String(result.orderId) : null,
        billitSentAt: new Date(),
      },
    });

    await writeAuditLog(prisma, {
      action: AUDIT_ACTIONS.CREDIT_NOTE_SENT_TO_BILLIT,
      entityType: "CreditNote",
      entityId: creditNote.id,
      metadata: { number: creditNote.number, invoiceNumber: invoice.number, billitOrderId: result.orderId ?? null, peppolRouted: Boolean(identifier) },
      actor: session.user,
    });

    return {
      success: true,
      message: identifier
        ? `Note de crédit ${creditNote.number} créée dans Billit avec routage Peppol — finalisez l'envoi depuis Billit.`
        : `Note de crédit ${creditNote.number} créée dans Billit — finalisez l'envoi (Peppol ou e-mail) depuis Billit.`,
    };
  } catch (error) {
    console.error("[sendCreditNoteToBillit]", error);
    return { success: false, message: "Impossible d'envoyer cette note de crédit à Billit." };
  }
}
