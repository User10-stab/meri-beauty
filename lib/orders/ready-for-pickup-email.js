import { escapeHtml } from "@/lib/email-templates";

function formatEuro(value) {
  return `${Number(value ?? 0).toFixed(2).replace(".", ",")} €`;
}

function formatBrusselsDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Brussels",
  });
}

function itemLabel(item) {
  const name = item.variantName ? `${item.productName} – ${item.variantName}` : item.productName;
  return `${item.quantity} × ${name}`;
}

/**
 * The « votre commande est prête » e-mail sent when staff click « Marquer
 * prête pour retrait » (markOrderReadyForPickup). The payment confirmation
 * for PICKUP_PREPAID already promises « Nous vous préviendrons dès qu'elle
 * sera prête » — this is that promise.
 *
 * PICKUP_ON_SITE orders are not paid yet: the e-mail says how much is due at
 * the counter and repeats the collection deadline (expire-stale-orders cancels
 * them after it). A prepaid order has no deadline, so none is shown.
 *
 * @param {{
 *   order: { orderNumber: number, fulfilmentMode: string, pickupCode?: string|null, totalAmount: unknown, expiresAt?: Date|string|null, items?: { productName: string, variantName?: string|null, quantity: number }[] },
 *   customerName?: string|null,
 *   salonAddress?: string|null,
 *   hasQrAttachment?: boolean,
 * }} input
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildOrderReadyForPickupEmail({ order, customerName, salonAddress, hasQrAttachment = false }) {
  const payOnSite = order.fulfilmentMode === "PICKUP_ON_SITE";
  const items = order.items ?? [];
  const greetingName = customerName?.trim() || "";
  const deadline = payOnSite && order.expiresAt ? formatBrusselsDate(order.expiresAt) : null;
  const amount = formatEuro(order.totalAmount);

  const subject = `Votre commande n°${order.orderNumber} est prête – Meri Beauty`;

  const textLines = [
    `Bonjour${greetingName ? ` ${greetingName}` : ""},`,
    "",
    `Bonne nouvelle : votre commande n°${order.orderNumber} est prête et vous attend en boutique.`,
  ];
  if (items.length) {
    textLines.push("", ...items.map((item) => `- ${itemLabel(item)}`));
  }
  textLines.push("");
  if (salonAddress) textLines.push(`Adresse : ${salonAddress}`);
  if (order.pickupCode) textLines.push(`Code de retrait : ${order.pickupCode}`);
  if (payOnSite) textLines.push(`Montant à régler sur place : ${amount}`);
  if (deadline) {
    textLines.push("", `Merci de venir la retirer au plus tard le ${deadline} — passé ce délai, la commande sera annulée.`);
  }
  textLines.push("", "À très bientôt,", "L'équipe Meri Beauty");

  const itemsHtml = items.length
    ? `<ul style="margin:0 0 16px;padding-left:20px;">${items.map((item) => `<li>${escapeHtml(itemLabel(item))}</li>`).join("")}</ul>`
    : "";
  const details = [
    salonAddress ? `<p style="margin:0 0 6px;"><strong>Adresse :</strong> ${escapeHtml(salonAddress)}</p>` : "",
    order.pickupCode ? `<p style="margin:0 0 6px;"><strong>Code de retrait :</strong> <span style="font-size:18px;letter-spacing:2px;">${escapeHtml(order.pickupCode)}</span></p>` : "",
    payOnSite ? `<p style="margin:0 0 6px;"><strong>Montant à régler sur place :</strong> ${escapeHtml(amount)}</p>` : "",
  ].join("");

  const html =
    `<p>Bonjour${greetingName ? ` ${escapeHtml(greetingName)}` : ""},</p>` +
    `<p>Bonne nouvelle : votre commande n°${order.orderNumber} est <strong>prête</strong> et vous attend en boutique.</p>` +
    itemsHtml +
    (details ? `<div style="margin:0 0 16px;padding:12px 16px;background:#F7F3EC;border-radius:6px;">${details}</div>` : "") +
    (hasQrAttachment && order.pickupCode
      ? `<p>Le QR code de retrait est joint à cet e-mail — présentez-le au comptoir, ou donnez simplement le code ci-dessus.</p>`
      : "") +
    (deadline
      ? `<p>Merci de venir la retirer au plus tard le <strong>${escapeHtml(deadline)}</strong> — passé ce délai, la commande sera annulée.</p>`
      : "") +
    `<p>À très bientôt,<br/>L'équipe Meri Beauty</p>`;

  return { subject, text: textLines.join("\n"), html };
}
