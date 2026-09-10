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
  PEPPYRUS_DOCUMENT_TYPE_INVOICE,
} from "@/lib/peppyrus";
import { buildInvoiceUbl } from "@/lib/peppyrus/build-ubl";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";

/**
 * Transmits this invoice over the live Peppol network via Peppyrus
 * (POST /message — see lib/peppyrus.js). Unlike the old Billit integration,
 * this call itself IS the delivery — there is no vendor dashboard staging
 * step afterward, so this action only proceeds once an admin has explicitly
 * confirmed the send in the UI.
 *
 * The buyer's Peppol participant id isn't on Invoice itself (that document
 * is a denormalized snapshot of name/VAT/address only) — it lives on the
 * BillingProfile of whichever User this payment's order/appointment/
 * reservation belongs to, so it's looked up via that chain. We prefer
 * resolving it fresh via Peppyrus's own directory (bestMatch) over trusting
 * that possibly-stale stored value.
 */
export async function sendInvoiceToPeppyrus(invoiceId) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Non autorisé." };
  }
  if (typeof invoiceId !== "string" || !invoiceId) {
    return { success: false, message: "Facture introuvable." };
  }

  const senderParticipantId = process.env.PEPPYRUS_SENDER_PARTICIPANT_ID?.trim();
  if (!senderParticipantId) {
    return { success: false, message: "Peppyrus n'est pas configuré (PEPPYRUS_SENDER_PARTICIPANT_ID manquant)." };
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

    // Peppyrus here is Peppol e-invoicing for Belgian companies — a B2C sale
    // or a foreign VAT number has nowhere sensible to route on that
    // network, so both are refused outright (v1 scope: BE-domestic-B2B only,
    // same restriction the old Billit integration had).
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

    // Prefer Peppyrus's own directory resolution over a possibly-stale
    // stored value; fall back to the stored identifier if bestMatch fails.
    const resolvedParticipantId =
      (await bestMatchPeppolParticipant({ vatNumber: invoice.customerVatNumber, countryCode: "BE" })) ?? storedPeppolRaw;

    if (!resolvedParticipantId || !parsePeppolIdentifier(resolvedParticipantId)) {
      return {
        success: false,
        message: "Aucun identifiant Peppol valide pour ce client (ni dans l'annuaire Peppyrus, ni enregistré sur son profil).",
      };
    }

    // Non-blocking: the recipient may legitimately not be in the directory
    // in test mode — this is a warning surfaced to the admin, not a hard
    // stop.
    const lookup = await lookupPeppolParticipant(resolvedParticipantId);
    const recipientWarning = lookup.canReceive
      ? null
      : " — le destinataire n'a pas pu être confirmé dans l'annuaire Peppol avant l'envoi.";

    const xml = buildInvoiceUbl({ invoice, salon, buyerParticipantId: resolvedParticipantId });

    const result = await sendPeppyrusMessage({
      sender: senderParticipantId,
      recipient: resolvedParticipantId,
      processType: PEPPYRUS_PROCESS_TYPE,
      documentType: PEPPYRUS_DOCUMENT_TYPE_INVOICE,
      fileContent: Buffer.from(xml, "utf-8").toString("base64"),
    });
    if (!result.success) {
      return { success: false, message: result.message ?? "Échec de l'envoi vers Peppyrus." };
    }

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        peppyrusMessageId: result.messageId ?? null,
        peppyrusSentAt: new Date(),
      },
    });

    await writeAuditLog(prisma, {
      action: AUDIT_ACTIONS.INVOICE_SENT_TO_PEPPYRUS,
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { number: invoice.number, peppyrusMessageId: result.messageId ?? null, recipientParticipantId: resolvedParticipantId },
      actor: session.user,
    });

    return {
      success: true,
      message: `Facture ${invoice.number} envoyée via Peppol (Peppyrus).${recipientWarning ?? ""}`,
    };
  } catch (error) {
    console.error("[sendInvoiceToPeppyrus]", error);
    return { success: false, message: error?.message?.startsWith("Incohérence") ? error.message : "Impossible d'envoyer cette facture à Peppyrus." };
  }
}
