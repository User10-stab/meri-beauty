"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import {
  sendPeppyrusMessage,
  bestMatchPeppolParticipant,
  lookupPeppolParticipant,
  parsePeppolIdentifier,
  isBelgianVatNumber,
  PEPPYRUS_PROCESS_TYPE,
  PEPPYRUS_DOCUMENT_TYPE_CREDIT_NOTE,
} from "@/lib/peppyrus";
import { buildCreditNoteUbl } from "@/lib/peppyrus/build-ubl";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";

/**
 * Transmits this credit note over the live Peppol network via Peppyrus —
 * same live-delivery contract as sendInvoiceToPeppyrus (see that file for
 * why there's no "finalize later" step, unlike the old Billit integration).
 *
 * Scoped to the same Belgian-B2B-only case as the invoice it corrects — a
 * credit note against a Belgian B2B invoice falls under the same 2026
 * structured e-invoicing mandate. E-mail remains a separate deliberate
 * delivery choice; this action is only the Peppol handoff.
 */
export async function sendCreditNoteToPeppyrus(creditNoteId) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Non autorisé." };
  }
  if (typeof creditNoteId !== "string" || !creditNoteId) {
    return { success: false, message: "Note de crédit introuvable." };
  }

  const senderParticipantId = process.env.PEPPYRUS_SENDER_PARTICIPANT_ID?.trim();
  if (!senderParticipantId) {
    return { success: false, message: "Peppyrus n'est pas configuré (PEPPYRUS_SENDER_PARTICIPANT_ID manquant)." };
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
        success: false,
        message: "Aucun identifiant Peppol valide pour ce client (ni dans l'annuaire Peppyrus, ni enregistré sur son profil).",
      };
    }

    const lookup = await lookupPeppolParticipant(resolvedParticipantId);
    const recipientWarning = lookup.canReceive
      ? null
      : " — le destinataire n'a pas pu être confirmé dans l'annuaire Peppol avant l'envoi.";

    const xml = buildCreditNoteUbl({ creditNote, invoice, salon, buyerParticipantId: resolvedParticipantId });

    const result = await sendPeppyrusMessage({
      sender: senderParticipantId,
      recipient: resolvedParticipantId,
      processType: PEPPYRUS_PROCESS_TYPE,
      documentType: PEPPYRUS_DOCUMENT_TYPE_CREDIT_NOTE,
      fileContent: Buffer.from(xml, "utf-8").toString("base64"),
    });
    if (!result.success) {
      return { success: false, message: result.message ?? "Échec de l'envoi vers Peppyrus." };
    }

    await prisma.creditNote.update({
      where: { id: creditNote.id },
      data: {
        peppyrusMessageId: result.messageId ?? null,
        peppyrusSentAt: new Date(),
      },
    });

    await writeAuditLog(prisma, {
      action: AUDIT_ACTIONS.CREDIT_NOTE_SENT_TO_PEPPYRUS,
      entityType: "CreditNote",
      entityId: creditNote.id,
      metadata: {
        number: creditNote.number,
        invoiceNumber: invoice.number,
        peppyrusMessageId: result.messageId ?? null,
        recipientParticipantId: resolvedParticipantId,
      },
      actor: session.user,
    });

    return {
      success: true,
      message: `Note de crédit ${creditNote.number} envoyée via Peppol (Peppyrus).${recipientWarning ?? ""}`,
    };
  } catch (error) {
    console.error("[sendCreditNoteToPeppyrus]", error);
    return {
      success: false,
      message: error?.message?.startsWith("Incohérence") ? error.message : "Impossible d'envoyer cette note de crédit à Peppyrus.",
    };
  }
}
