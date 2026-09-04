/**
 * Sends the optional B2C refund confirmation. This is deliberately called by
 * an administrator from Operations, never by a webhook or settlement action.
 * A B2C customer receives a plain confirmation only: no credit note, refund
 * receipt, accounting-adjustment wording, or attachment.
 */
import { sendEmail } from "@/lib/email";
import { brandedHtml, escapeHtml } from "@/lib/email-templates";
import { isBusinessRefundCustomer } from "@/lib/refunds/document-policy";

const money = (value) =>
  new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

const METHOD_LABEL = Object.freeze({
  ONLINE: "carte bancaire (en ligne)",
  CARD: "carte bancaire (terminal en boutique)",
  CASH: "espèces",
});

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
  if (payment?.workshopReservation) return payment.workshopReservation.session?.workshop?.title ?? "votre réservation";
  if (payment?.formationReservation) return payment.formationReservation.session?.formation?.title ?? "votre formation";
  if (payment?.order) return `votre commande n°${payment.order.orderNumber}`;
  if (payment?.appointment) return "votre rendez-vous";
  return "votre réservation";
}

/** @param {{ prisma: import("@prisma/client").PrismaClient, operationId: string }} input */
export async function sendB2CRefundConfirmation({ prisma, operationId }) {
  const operation = await prisma.refundOperation.findUnique({
    where: { id: operationId },
    include: {
      legs: true,
      creditNote: true,
      invoice: { select: { customerEmail: true, customerName: true } },
      payment: {
        select: {
          appointment: { select: { user: { select: { fullName: true, email: true, isCompany: true, vatNumber: true } } } },
          workshopReservation: { select: { session: { select: { workshop: { select: { title: true } } } }, customer: { select: { fullName: true, email: true, isCompany: true, vatNumber: true } } } },
          formationReservation: { select: { session: { select: { formation: { select: { title: true } } } }, customer: { select: { fullName: true, email: true, isCompany: true, vatNumber: true } } } },
          order: { select: { orderNumber: true, user: { select: { fullName: true, email: true, isCompany: true, vatNumber: true } } } },
        },
      },
    },
  });
  if (!operation) return { sent: false, reason: "OPERATION_NOT_FOUND" };
  if (operation.status !== "COMPLETED" || operation.legs.some((leg) => leg.status !== "SUCCEEDED" || (leg.settledAmount != null && Number(leg.settledAmount) + 0.01 < Number(leg.amount)))) {
    return { sent: false, reason: "LEGS_OUTSTANDING" };
  }
  if (operation.creditNote || isBusinessRefundCustomer(resolveCustomer(operation))) {
    return { sent: false, reason: "B2B_CREDIT_NOTE_REQUIRED" };
  }
  if (operation.customerNotifiedAt) return { sent: false, reason: "ALREADY_NOTIFIED" };

  const recipient = resolveRecipient(operation);
  if (!recipient.email) return { sent: false, reason: "NO_RECIPIENT" };

  const claim = await prisma.refundOperation.updateMany({
    where: { id: operation.id, customerNotifiedAt: null },
    data: { customerNotifiedAt: new Date() },
  });
  if (claim.count === 0) return { sent: false, reason: "ALREADY_NOTIFIED" };

  const settledOf = (leg) => Number(leg.settledAmount ?? leg.amount);
  const total = operation.legs.reduce((sum, leg) => sum + settledOf(leg), 0);
  const methodLines = operation.legs.map((leg) => `${money(settledOf(leg))} — ${METHOD_LABEL[leg.method] ?? leg.method}`);
  const bankDelayNote = operation.legs.some((leg) => leg.method === "ONLINE")
    ? "Le remboursement par carte peut mettre 5 à 10 jours ouvrables à apparaître sur votre relevé, selon votre banque."
    : null;

  const text = [
    `Bonjour ${recipient.name},`, "",
    `Nous confirmons votre remboursement de ${money(total)} concernant ${describeItem(operation)}.`, "",
    "Détail du remboursement:", ...methodLines.map((line) => `  - ${line}`), "",
    bankDelayNote, "", "L'équipe Meri Beauty",
  ].filter((line) => line !== null).join("\n");
  const html = brandedHtml("Remboursement confirmé", [
    `<p>Bonjour ${escapeHtml(recipient.name)},</p>`,
    `<p>Nous confirmons votre remboursement de <strong>${money(total)}</strong> concernant <strong>${escapeHtml(describeItem(operation))}</strong>.</p>`,
    "<p><strong>Détail du remboursement:</strong></p>",
    `<ul>${methodLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
    bankDelayNote ? `<p style="color:#666;">${escapeHtml(bankDelayNote)}</p>` : "",
    "<p>L'équipe Meri Beauty</p>",
  ].join(""));

  const result = await sendEmail({ to: recipient.email, subject: `Remboursement confirmé — ${money(total)}`, text, html });
  if (result?.success === false) {
    await prisma.refundOperation.update({ where: { id: operation.id }, data: { customerNotifiedAt: null } });
    return { sent: false, reason: "EMAIL_PROVIDER_FAILED" };
  }
  return { sent: true };
}
