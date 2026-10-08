import { prisma } from "@/lib/prisma";
import { renderTicketPdf } from "@/lib/pdf/render";
import { formatSalonAddress } from "@/lib/format-address";
import { sendEmail } from "@/lib/email";
import { captureError } from "@/lib/monitoring";
import { orderTicketLines } from "@/lib/orders/fulfill-order-payment";

/**
 * The ticket of a fully-paid manual sale that ends without an invoice — a
 * buyer with no validated VAT number, or one who declined the invoice. Same
 * document and same e-mail as a ticket sale at the till
 * (completePointOfSaleSale), so whether the sale went through the invoice
 * path (transfer, acompte, « payer plus tard », free line) or not, the client
 * gets the same thing.
 *
 * Runs after the sale's transaction: a render or e-mail failure never undoes
 * a sale already recorded. Best-effort, reported to monitoring.
 *
 * @returns {Promise<{ ticketNumber: string|null, ticketPdfBase64: string|null, receiptEmailSent: boolean }>}
 */
export async function deliverManualSaleReceipt(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      ticketNumber: true,
      createdAt: true,
      totalAmount: true,
      totalExclVat: true,
      totalVat: true,
      vatRate: true,
      discountAmount: true,
      user: { select: { email: true, fullName: true } },
      items: { select: { productName: true, quantity: true, unitPrice: true }, orderBy: { id: "asc" } },
    },
  });
  if (!order?.ticketNumber) return { ticketNumber: null, ticketPdfBase64: null, receiptEmailSent: false };

  const salon = await prisma.salon.findUnique({
    where: { id: "main-salon" },
    select: { legalName: true, vatNumber: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, countryCode: true },
  });
  const pdf = await renderTicketPdf({
    orderNumber: order.orderNumber,
    ticketNumber: order.ticketNumber,
    issuedAt: order.createdAt,
    sellerName: salon?.legalName || "Meri Beauty",
    sellerAddress: formatSalonAddress(salon),
    sellerVatNumber: salon?.vatNumber ?? null,
    subtotalExclVat: order.totalExclVat,
    vatRate: order.vatRate,
    vatAmount: order.totalVat,
    totalInclVat: order.totalAmount,
    lines: orderTicketLines(order),
  }).catch((error) => {
    captureError(error, { area: "manual-sale", orderId: order.id, context: "receipt-pdf" });
    return null;
  });

  let receiptEmailSent = false;
  if (pdf && order.user?.email) {
    const total = Number(order.totalAmount).toFixed(2);
    const email = {
      to: order.user.email,
      subject: `Votre reçu — Commande n°${order.orderNumber} — Meri Beauty`,
      text: `Bonjour ${order.user.fullName},\n\nMerci pour votre achat. Votre reçu pour la commande n°${order.orderNumber} (${total} €) est joint à cet e-mail.\n\nL'équipe Meri Beauty`,
      html: `<p>Bonjour ${order.user.fullName},</p><p>Merci pour votre achat.</p><p>Votre reçu pour la commande n°${order.orderNumber} (<strong>${total} €</strong>) est joint à cet e-mail.</p><p>L'équipe Meri Beauty</p>`,
      attachments: [{ filename: `${order.ticketNumber}.pdf`, content: pdf }],
    };
    let sent = await sendEmail(email).catch(() => null);
    if (!sent?.success) sent = await sendEmail(email).catch(() => null);
    receiptEmailSent = Boolean(sent?.success);
    if (!receiptEmailSent) {
      captureError(new Error(sent?.error || "Manual sale receipt email failed"), { area: "manual-sale", orderId: order.id, context: "receipt-email" });
    }
  }

  return { ticketNumber: order.ticketNumber, ticketPdfBase64: pdf ? pdf.toString("base64") : null, receiptEmailSent };
}
