/**
 * Step 4: tell the customer, exactly once, once the money has actually
 * arrived everywhere.
 *
 * The handoff's hardest "do not" lives here: never send "remboursement
 * réussi" straight after calling Stripe. Stripe accepting a refund request
 * is not the money landing, and a CASH or CARD leg may still be sitting on
 * the counter waiting for someone to open the drawer. So this refuses to
 * send until EVERY leg has SUCCEEDED.
 *
 * `customerNotifiedAt` is claimed with a conditional update before the mail
 * goes out, so a redelivered Stripe webhook (at-least-once, by design) or a
 * second admin confirmation loses the race and sends nothing.
 */

import { sendEmail } from "@/lib/email";
import { brandedHtml, escapeHtml } from "@/lib/email-templates";
import { renderCreditNotePdf, renderRefundReceiptPdf } from "@/lib/pdf/render";
import { isBusinessRefundCustomer } from "@/lib/refunds/document-policy";

const money = (value) =>
  new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

const METHOD_LABEL = Object.freeze({
  ONLINE: "carte bancaire (en ligne)",
  CARD: "carte bancaire (terminal en boutique)",
  CASH: "espèces",
});

/**
 * Who to write to, per origin. Every branch reads the customer off the
 * booking rather than taking an address from the caller — the same reason
 * sendCreditNoteByEmail reads its recipient off the invoice.
 */
function resolveCustomer(operation) {
  const payment = operation.payment;
  return (
    payment?.appointment?.user ??
    payment?.workshopReservation?.customer ??
    payment?.formationReservation?.customer ??
    payment?.order?.user ??
    null
  );
}

function resolveRecipient(operation) {
  const customer = resolveCustomer(operation);

  return {
    email: customer?.email?.trim() ?? operation.invoice?.customerEmail?.trim() ?? null,
    name: customer?.fullName ?? operation.invoice?.customerName ?? "",
  };
}

function describeItem(operation) {
  const payment = operation.payment;
  if (payment?.workshopReservation) {
    return payment.workshopReservation.session?.workshop?.title ?? "votre réservation";
  }
  if (payment?.formationReservation) {
    return payment.formationReservation.session?.formation?.title ?? "votre formation";
  }
  if (payment?.order) return `votre commande n°${payment.order.orderNumber}`;
  if (payment?.appointment) return "votre rendez-vous";
  return "votre réservation";
}

async function buildRefundReceipt(prisma, operation, recipient) {
  const salon = await prisma.salon.findUnique({
    where: { id: "main-salon" },
    select: { name: true, address: true, vatNumber: true },
  });
  return {
    number: operation.refundReceiptNumber,
    issuedAt: operation.createdAt,
    sellerName: salon?.name ?? "Meri Beauty",
    sellerAddress: salon?.address ?? null,
    sellerVatNumber: salon?.vatNumber ?? null,
    customerName: recipient.name,
    customerEmail: recipient.email,
    itemLabel: describeItem(operation),
    reason: operation.reason,
  };
}

/**
 * Sends the single closing e-mail if — and only if — the operation is
 * genuinely finished and nobody has mailed it yet.
 *
 * @param {object} input
 * @param {import("@prisma/client").PrismaClient} input.prisma
 * @param {string} input.operationId
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export async function notifyRefundComplete({ prisma, operationId }) {
  const operation = await prisma.refundOperation.findUnique({
    where: { id: operationId },
    include: {
      legs: true,
      creditNote: true,
      invoice: { include: { lines: true } },
      payment: {
        select: {
          appointment: { select: { date: true, user: { select: { fullName: true, email: true, isCompany: true, vatNumber: true } } } },
          workshopReservation: {
            select: {
              session: { select: { workshop: { select: { title: true } } } },
              customer: { select: { fullName: true, email: true, isCompany: true, vatNumber: true } },
            },
          },
          formationReservation: {
            select: {
              session: { select: { formation: { select: { title: true } } } },
              customer: { select: { fullName: true, email: true, isCompany: true, vatNumber: true } },
            },
          },
          order: { select: { orderNumber: true, user: { select: { fullName: true, email: true, isCompany: true, vatNumber: true } } } },
        },
      },
    },
  });
  if (!operation) return { sent: false, reason: "OPERATION_NOT_FOUND" };

  // The whole point. A Stripe leg that landed while the terminal leg is
  // still outstanding means the admin screen shows "remboursement partiel —
  // confirmation terminal requise", and the customer hears nothing yet.
  //
  // A leg that settled SHORT counts as outstanding too. An admin refunding
  // 50 € against a 75 € leg has moved real money, so the leg is SUCCEEDED —
  // but announcing "remboursement de 75,00 €" would be a false statement
  // about the customer's own bank account. Same rule as
  // operation-status.js#isFullySettled, deliberately duplicated rather than
  // shared, because these two must never drift apart quietly.
  const outstanding = operation.legs.filter(
    (leg) =>
      leg.status !== "SUCCEEDED" ||
      (leg.settledAmount != null && Number(leg.settledAmount) + 0.01 < Number(leg.amount)),
  );
  if (outstanding.length > 0) return { sent: false, reason: "LEGS_OUTSTANDING" };
  if (operation.customerNotifiedAt) return { sent: false, reason: "ALREADY_NOTIFIED" };
  if (operation.refundReceiptNumber && isBusinessRefundCustomer(resolveCustomer(operation))) {
    console.error(`[notifyRefundComplete] blocked B2C receipt for B2B operation ${operation.id}`);
    return { sent: false, reason: "B2B_REFUND_RECEIPT_FORBIDDEN" };
  }

  const recipient = resolveRecipient(operation);
  if (!recipient.email) return { sent: false, reason: "NO_RECIPIENT" };

  // Claim the right to send BEFORE sending. Two webhooks arriving together
  // both reach this line; only one updates a row where customerNotifiedAt
  // is still null, and the loser returns without mailing.
  const claim = await prisma.refundOperation.updateMany({
    where: { id: operation.id, customerNotifiedAt: null },
    data: { customerNotifiedAt: new Date() },
  });
  if (claim.count === 0) return { sent: false, reason: "ALREADY_NOTIFIED" };

  // What actually went back, not what was planned. They are the same figure
  // unless an admin over-refunded in Stripe — in which case the customer's
  // statement will show the larger amount, and the e-mail must agree with
  // their bank rather than with our plan. (Under-refunds never reach here:
  // they are held as outstanding above.)
  const settledOf = (leg) => Number(leg.settledAmount ?? leg.amount);
  const total = operation.legs.reduce((sum, leg) => sum + settledOf(leg), 0);
  const hasOnlineLeg = operation.legs.some((leg) => leg.method === "ONLINE");
  const item = describeItem(operation);

  const methodLines = operation.legs.map(
    (leg) => `${money(settledOf(leg))} — ${METHOD_LABEL[leg.method] ?? leg.method}`,
  );

  // The indicative bank delay applies only to the card leg; cash was handed
  // over in person and is not "on its way".
  const bankDelayNote = hasOnlineLeg
    ? "Le remboursement par carte peut mettre 5 à 10 jours ouvrables à apparaître sur votre relevé, selon votre banque."
    : null;

  const documentNote = operation.creditNote
    ? `Votre note de crédit ${operation.creditNote.number} est jointe à cet e-mail.`
    : operation.refundReceiptNumber
      ? `Votre justificatif de remboursement porte le numéro ${operation.refundReceiptNumber}.`
      : null;

  const attachments = [];
  if (operation.creditNote && operation.invoice) {
    try {
      attachments.push({
        filename: `note-de-credit-${operation.creditNote.number}.pdf`,
        content: await renderCreditNotePdf(operation.creditNote, operation.invoice),
      });
    } catch (error) {
      // A PDF that fails to render must not cost the customer their
      // notification — the numbers in the body are the substance.
      console.error(`[notifyRefundComplete] credit note PDF failed for ${operation.id}:`, error);
    }
  }
  if (operation.refundReceiptNumber) {
    try {
      const receipt = await buildRefundReceipt(prisma, operation, recipient);
      attachments.push({
        filename: `justificatif-remboursement-${operation.refundReceiptNumber}.pdf`,
        content: await renderRefundReceiptPdf(operation, receipt),
      });
    } catch (error) {
      console.error(`[notifyRefundComplete] refund receipt PDF failed for ${operation.id}:`, error);
    }
  }

  const financialCorrection = operation.trigger === "FINANCIAL_CORRECTION" || operation.trigger === "NO_SHOW_EXCEPTION";

  const text = [
    `Bonjour ${recipient.name},`,
    "",
    `Nous confirmons ${financialCorrection ? "la correction financière concernant" : "l'annulation de"} ${item} et le remboursement de ${money(total)}.`,
    "",
    "Détail du remboursement :",
    ...methodLines.map((line) => `  - ${line}`),
    "",
    documentNote,
    bankDelayNote,
    "",
    "L'équipe Meri Beauty",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const html = brandedHtml(
    financialCorrection ? "Correction financière et remboursement" : "Annulation et remboursement",
    [
      `<p>Bonjour ${escapeHtml(recipient.name)},</p>`,
      `<p>Nous confirmons ${financialCorrection ? "la correction financière concernant" : "l'annulation de"} <strong>${escapeHtml(item)}</strong> et le remboursement de <strong>${money(total)}</strong>.</p>`,
      "<p><strong>Détail du remboursement :</strong></p>",
      `<ul>${methodLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
      documentNote ? `<p>${escapeHtml(documentNote)}</p>` : "",
      bankDelayNote ? `<p style="color:#666;">${escapeHtml(bankDelayNote)}</p>` : "",
      "<p>L'équipe Meri Beauty</p>",
    ].join(""),
  );

  const result = await sendEmail({
    to: recipient.email,
    subject: `${financialCorrection ? "Correction financière" : "Annulation"} et remboursement — ${money(total)}`,
    text,
    html,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  // sendEmail resolves with { success: false } on a provider failure rather
  // than throwing (same contract sendCreditNoteByEmail relies on). Release
  // the claim so a later retry — or the admin — can send it, instead of
  // leaving a customer silently un-notified behind a timestamp that says
  // otherwise.
  if (result?.success === false) {
    await prisma.refundOperation.update({
      where: { id: operation.id },
      data: { customerNotifiedAt: null },
    });
    return { sent: false, reason: "EMAIL_PROVIDER_FAILED" };
  }

  return { sent: true };
}
