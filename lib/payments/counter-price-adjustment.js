const MAX_COUNTER_TOTAL = 100_000;

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Validates an operator-entered final price before a counter settlement.
 * A price may never fall below money already collected: that is a refund,
 * and must go through the refund workflow with its own correcting document.
 */
export function resolveCounterPriceAdjustment({ baseTotal, paidAmount = 0, finalTotal, reason }) {
  const currentTotal = money(baseTotal);
  const alreadyPaid = money(paidAmount);
  const hasRequestedTotal = finalTotal !== undefined && finalTotal !== null && finalTotal !== "";
  const requestedTotal = hasRequestedTotal ? money(finalTotal) : currentTotal;

  if (!Number.isFinite(currentTotal) || currentTotal < 0) {
    return { success: false, message: "Le prix actuel est invalide." };
  }
  if (!Number.isFinite(requestedTotal) || requestedTotal < 0 || requestedTotal > MAX_COUNTER_TOTAL) {
    return { success: false, message: "Indiquez un prix final valide." };
  }
  if (requestedTotal < alreadyPaid) {
    return {
      success: false,
      message: "Le prix final ne peut pas être inférieur au montant déjà encaissé. Utilisez le parcours de remboursement.",
    };
  }

  const changed = requestedTotal !== currentTotal;
  const cleanReason = String(reason ?? "").trim();
  if (changed && cleanReason.length < 3) {
    return { success: false, message: "Indiquez la raison de l'ajustement de prix." };
  }

  return {
    success: true,
    changed,
    previousTotal: currentTotal,
    finalTotal: requestedTotal,
    paidAmount: alreadyPaid,
    amountDue: money(requestedTotal - alreadyPaid),
    reason: changed ? cleanReason : null,
  };
}
