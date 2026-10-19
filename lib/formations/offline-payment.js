function roundMoney(value) {
  return Number((Math.round((Number(value) + Number.EPSILON) * 100) / 100).toFixed(2));
}

/** Shared estimate and server-side calculation for a manually recorded transfer. */
export function calculateOfflineFormationPayment(totalPrice, depositPercentage, mode) {
  const totalAmount = roundMoney(totalPrice);
  const rawPercentage = Number(depositPercentage ?? 50);
  const percentage = Number.isFinite(rawPercentage) ? Math.min(100, Math.max(0, rawPercentage)) : 0;
  const paidAmount = mode === "FULL" ? totalAmount : roundMoney((totalAmount * percentage) / 100);
  const balanceDue = roundMoney(Math.max(0, totalAmount - paidAmount));

  return {
    totalAmount,
    paidAmount,
    balanceDue,
    isFullPayment: balanceDue <= 0.01,
  };
}
