/**
 * Resolves the way an order was actually paid. Payment.paymentType is too
 * broad for this purpose: both cash and an external card terminal are
 * ON_SITE, while the immutable Transaction row records the real method.
 */
export function getOrderPaymentMethod(payment) {
  if (!payment) return null;
  if (payment.transactionReference) return "ONLINE";

  return (
    payment.transactions?.find((transaction) => transaction.transactionType === "FINAL_PAYMENT")?.method ??
    "CASH"
  );
}

export function isManualOrderRefund(payment) {
  return Boolean(payment) && getOrderPaymentMethod(payment) !== "ONLINE";
}

export function refundMethodLabel(method) {
  if (method === "ONLINE") return "Carte en ligne (Stripe QR)";
  if (method === "CARD") return "Carte — terminal en boutique";
  return "Espèces";
}

export function manualRefundInstruction(method) {
  if (method === "CARD") {
    return "Effectuez d'abord le remboursement sur le terminal de paiement, puis saisissez la référence du ticket ci-dessous.";
  }
  return "Remettez d'abord les espèces au client, puis confirmez ci-dessous que le remboursement a bien été effectué.";
}

/** The server invokes this before any stock, invoice, or payment mutation. */
export function validateManualRefundConfirmation({ method, confirmed, reference }) {
  if (method === "ONLINE") return null;
  if (confirmed !== true) return "Confirmez que le remboursement physique a été effectué avant de finaliser.";
  if (method === "CARD" && !reference?.trim()) {
    return "La référence du ticket de remboursement du terminal est obligatoire.";
  }
  return null;
}
