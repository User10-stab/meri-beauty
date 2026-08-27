"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { createBillitOrder, parsePeppolIdentifier } from "@/lib/billit";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";

/**
 * Creates this invoice as an order in Billit (POST /v1/orders only — see
 * lib/billit.js for why). Staff finish the actual Peppol/e-mail dispatch
 * from inside Billit's own dashboard; this action's job ends at "Billit now
 * has the document and, if the buyer has a Peppol identifier on file, the
 * routing hint to go with it."
 *
 * The buyer's Peppol participant id isn't on Invoice itself (that document
 * is a denormalized snapshot of name/VAT/address only) — it lives on the
 * BillingProfile of whichever User this payment's order/appointment/
 * reservation belongs to, so it's looked up via that chain.
 */
export async function sendInvoiceToBillit(invoiceId) {
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
        payment: {
          select: {
            order: { select: { userId: true } },
            appointment: { select: { userId: true } },
            workshopReservation: { select: { customerId: true } },
            formationReservation: { select: { customerId: true } },
          },
        },
      },
    });
    if (!invoice) return { success: false, message: "Facture introuvable." };

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

    const pdf = await renderInvoicePdf(invoice);
    const isoDate = invoice.issuedAt.toISOString().slice(0, 10);
    const buyerName = invoice.customerLegalName || invoice.customerName;

    const payload = {
      OrderType: "Invoice",
      OrderDirection: "Income",
      OrderNumber: invoice.number,
      OrderDate: isoDate,
      // Invoice carries no separate due-date field today — same-day, matching
      // the equivalent flow's own choice when a document has no explicit term.
      ExpiryDate: isoDate,
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
      OrderLines: invoice.lines.map((line) => ({
        Quantity: line.quantity,
        UnitPriceExcl: Number(line.unitPriceExclVat),
        Description: line.description,
        VATPercentage: Number(invoice.vatRate),
      })),
      OrderPDF: {
        FileName: `facture-${invoice.number}.pdf`,
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

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        billitOrderId: result.orderId != null ? String(result.orderId) : null,
        billitSentAt: new Date(),
      },
    });

    await writeAuditLog(prisma, {
      action: AUDIT_ACTIONS.INVOICE_SENT_TO_BILLIT,
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { number: invoice.number, billitOrderId: result.orderId ?? null, peppolRouted: Boolean(identifier) },
      actor: session.user,
    });

    return {
      success: true,
      message: identifier
        ? `Facture ${invoice.number} créée dans Billit avec routage Peppol — finalisez l'envoi depuis Billit.`
        : `Facture ${invoice.number} créée dans Billit — finalisez l'envoi (Peppol ou e-mail) depuis Billit.`,
    };
  } catch (error) {
    console.error("[sendInvoiceToBillit]", error);
    return { success: false, message: "Impossible d'envoyer cette facture à Billit." };
  }
}
