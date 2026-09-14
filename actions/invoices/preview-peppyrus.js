"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import {
  bestMatchPeppolParticipant,
  lookupPeppolParticipant,
  parsePeppolIdentifier,
  isBelgianVatNumber,
} from "@/lib/peppyrus";
import { buildInvoiceUbl, buildCreditNoteUbl } from "@/lib/peppyrus/build-ubl";
import { normalizeVatNumber } from "@/lib/vat-validation";

/**
 * Read-only counterpart to sendInvoiceToPeppyrus/sendCreditNoteToPeppyrus:
 * runs the exact same resolution + UBL build (so any of the same errors —
 * missing seller data, no Peppol identifier, the TVA cross-check, EN16931
 * field gaps — surface here first) but never calls sendPeppyrusMessage. Once
 * that POST fires, Peppyrus has accepted the transmission and there's no
 * undo, so this is the only safe way to see the document beforehand.
 */

function cleanRegNo(raw) {
  return String(raw ?? "").replace(/\D/g, "");
}

async function resolveBuyer(invoice) {
  const buyerUserId =
    invoice.payment?.order?.userId ??
    invoice.payment?.appointment?.userId ??
    invoice.payment?.workshopReservation?.customerId ??
    invoice.payment?.formationReservation?.customerId ??
    null;

  let storedPeppolRaw = null;
  if (buyerUserId) {
    const billingProfile = await prisma.billingProfile.findUnique({
      where: { userId: buyerUserId },
      select: { peppolParticipantId: true },
    });
    storedPeppolRaw = billingProfile?.peppolParticipantId?.trim() || null;
  }

  const resolvedParticipantId =
    (await bestMatchPeppolParticipant({ vatNumber: invoice.customerVatNumber, countryCode: "BE" })) ?? storedPeppolRaw;

  if (!resolvedParticipantId || !parsePeppolIdentifier(resolvedParticipantId)) {
    return {
      error: "Aucun identifiant Peppol valide pour ce client (ni dans l'annuaire Peppyrus, ni enregistré sur son profil).",
    };
  }

  const lookup = await lookupPeppolParticipant(resolvedParticipantId);
  const recipientWarning = lookup.canReceive
    ? null
    : "Le destinataire n'a pas pu être confirmé dans l'annuaire Peppol.";

  return { resolvedParticipantId, recipientWarning };
}

function buildSummary({ invoice, salon, resolvedParticipantId, recipientWarning, lines, documentNumber, documentType }) {
  return {
    documentType,
    documentNumber,
    issueDate: (documentType === "CREDIT_NOTE" ? invoice.creditNoteIssuedAt : invoice.issuedAt)?.toISOString().slice(0, 10),
    dueDate: invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : null,
    paymentTermsNote: invoice.dueDate ? null : "Facture acquittée — montant déjà réglé au moment de l'émission.",
    buyerReference: invoice.purchaseOrderReference || documentNumber,
    seller: {
      name: salon.legalName,
      vatNumber: normalizeVatNumber(salon.vatNumber),
      companyRegistrationNo: cleanRegNo(salon.companyRegistrationNo || salon.vatNumber),
      address: [salon.addressLine1, salon.addressLine2, salon.postalCode, salon.city, salon.countryCode]
        .filter(Boolean)
        .join(", "),
    },
    buyer: {
      name: invoice.customerLegalName || invoice.customerName,
      vatNumber: normalizeVatNumber(invoice.customerVatNumber),
      companyRegistrationNo: cleanRegNo(invoice.customerRegistrationNo || invoice.customerVatNumber),
      address: invoice.customerAddress || null,
      peppolParticipantId: resolvedParticipantId,
      recipientWarning,
    },
    lines,
    subtotalExclVat: Number(invoice.subtotalExclVat),
    vatRate: Number(invoice.vatRate),
    vatAmount: Number(invoice.vatAmount),
    totalInclVat: Number(invoice.totalInclVat),
  };
}

export async function previewInvoicePeppyrusDocument(invoiceId) {
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

    if (invoice.customerType !== "B2B") {
      return { success: false, message: "Seules les factures B2B peuvent être envoyées via Peppyrus." };
    }
    if (!isBelgianVatNumber(invoice.customerVatNumber)) {
      return { success: false, message: "Peppyrus est réservé aux clients avec un numéro de TVA belge (BE…)." };
    }

    const salon = await prisma.salon.findUnique({ where: { id: "main-salon" } });
    if (!salon?.legalName || !salon?.vatNumber) {
      return { success: false, message: "Identité légale du salon incomplète (Réglages > Salon) — impossible d'émettre un document Peppol." };
    }

    const { resolvedParticipantId, recipientWarning, error } = await resolveBuyer(invoice);
    if (error) return { success: false, message: error };

    // This is the exact same call the real send makes — any UBL-level
    // validation error (assertTotalsMatch, missing fields, ...) throws here
    // too, so the preview never claims a document is fine when it isn't.
    const xml = buildInvoiceUbl({ invoice, salon, buyerParticipantId: resolvedParticipantId });

    const lines = invoice.lines.map((line) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unitPriceExclVat: Number(line.unitPriceExclVat),
      lineTotalExclVat: Number(line.lineTotalExclVat),
      vatRate: Number(invoice.vatRate),
    }));

    return {
      success: true,
      xml,
      summary: buildSummary({
        invoice,
        salon,
        resolvedParticipantId,
        recipientWarning,
        lines,
        documentNumber: invoice.number,
        documentType: "INVOICE",
      }),
    };
  } catch (error) {
    console.error("[previewInvoicePeppyrusDocument]", error);
    return { success: false, message: error?.message?.startsWith("Incohérence") ? error.message : "Impossible de générer l'aperçu du document." };
  }
}

export async function previewCreditNotePeppyrusDocument(creditNoteId) {
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
      return { success: false, message: "Seules les notes de crédit sur facture B2B peuvent être envoyées via Peppyrus." };
    }
    if (!isBelgianVatNumber(invoice.customerVatNumber)) {
      return { success: false, message: "Peppyrus est réservé aux clients avec un numéro de TVA belge (BE…)." };
    }

    const salon = await prisma.salon.findUnique({ where: { id: "main-salon" } });
    if (!salon?.legalName || !salon?.vatNumber) {
      return { success: false, message: "Identité légale du salon incomplète (Réglages > Salon) — impossible d'émettre un document Peppol." };
    }

    const { resolvedParticipantId, recipientWarning, error } = await resolveBuyer(invoice);
    if (error) return { success: false, message: error };

    const xml = buildCreditNoteUbl({ creditNote, invoice, salon, buyerParticipantId: resolvedParticipantId });

    const lines = [
      {
        description: creditNote.reason?.trim() || `Note de crédit relative à la facture ${invoice.number}`,
        quantity: 1,
        unitPriceExclVat: Number(creditNote.subtotalExclVat),
        lineTotalExclVat: Number(creditNote.subtotalExclVat),
        vatRate: Number(invoice.vatRate),
      },
    ];

    return {
      success: true,
      xml,
      summary: {
        ...buildSummary({
          invoice: { ...invoice, subtotalExclVat: creditNote.subtotalExclVat, vatAmount: creditNote.vatAmount, totalInclVat: creditNote.totalInclVat, creditNoteIssuedAt: creditNote.issuedAt },
          salon,
          resolvedParticipantId,
          recipientWarning,
          lines,
          documentNumber: creditNote.number,
          documentType: "CREDIT_NOTE",
        }),
        relatesToInvoiceNumber: invoice.number,
      },
    };
  } catch (error) {
    console.error("[previewCreditNotePeppyrusDocument]", error);
    return { success: false, message: error?.message?.startsWith("Incohérence") ? error.message : "Impossible de générer l'aperçu du document." };
  }
}
