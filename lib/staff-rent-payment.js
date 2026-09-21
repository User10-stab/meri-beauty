/**
 * Staff rent (« location de poste ») is paid by bank transfer, and — like
 * every sale on the site — only invoiced once it is paid.
 *
 * When a rent falls due (lib/staff-monthly-billing.js on the anniversary
 * date, lib/staff-invoice.js for the first period of a new contract), NO
 * invoice is issued. The StaffMonthlyInvoice row records the rent due
 * (status AWAITING_PAYMENT: amount, period label, due date) with a PENDING
 * Payment. Only when an admin accepts the transfer (« Accepter le paiement »,
 * Factures page — actions/invoices/staff-rent.js) is the TRANSFER recorded
 * and the invoice issued, already paid, in the same transaction. A staff
 * member who never pays never receives an invoice, and no number is used.
 *
 * The Payment's source is the rent contract (Payment.staffContractId — the
 * fifth source of the Payment_exactly_one_source CHECK). payeeStaffId stays
 * null: the rent is the salon's income.
 *
 * Not a "use server" module.
 */

/**
 * issueInvoice's input for an accepted rent. Shared by « Accepter »
 * (actions/invoices/staff-rent.js) and the Factures preview, so the preview
 * is the invoice accepting will issue.
 */
export function rentInvoiceInput({ paymentId, amount, lineDescription, customer }) {
  return {
    paymentId,
    source: "STAFF_CONTRACT",
    totalInclVat: amount,
    customer,
    lines: [{ description: lineDescription || "Location d'espace", quantity: 1, unitPrice: amount }],
  };
}

/** A rent Payment awaiting its transfer: nothing received yet. */
export function pendingRentPaymentData(amount, contractId) {
  return { staffContractId: contractId, totalAmount: amount, paidAmount: 0, remainingAmount: amount, paymentType: "ON_SITE", status: "PENDING" };
}

/**
 * Records a rent due, inside the caller's transaction: its pending Payment and
 * its StaffMonthlyInvoice row (AWAITING_PAYMENT). The row's
 * @@unique([staffId, billingYear, billingMonth]) still makes a second run for
 * the same period fail with P2002, as before.
 *
 * @param {object} tx - Prisma transaction client
 * @param {{ staffId: string, contractId: string, billingYear: number, billingMonth: number,
 *           amount: number, lineDescription: string, dueDate?: Date|null }} rent
 */
export async function createPendingRent(tx, { staffId, contractId, billingYear, billingMonth, amount, lineDescription, dueDate = null }) {
  const payment = await tx.payment.create({ data: pendingRentPaymentData(amount, contractId), select: { id: true } });
  return tx.staffMonthlyInvoice.create({
    data: {
      staffId,
      billingYear,
      billingMonth,
      contractId,
      status: "AWAITING_PAYMENT",
      paymentId: payment.id,
      amount,
      lineDescription,
      dueDate,
    },
  });
}
