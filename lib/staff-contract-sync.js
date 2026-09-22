/**
 * Editing a staff member's rent contract (user's call, 2026-09-22): the
 * change flows into billing by itself — for the invoices still to come.
 * An invoice already created NEVER changes (amount or échéance): it is what
 * the staff member received; correcting one is a credit note, or a
 * deliberate one-off fix.
 *
 *   - Rent (fixedRent), payment delay N (Contract.dueDate, days), end date,
 *     notes: the ACTIVE contract is updated in place, so its schedule
 *     (nextInvoiceDate) is kept and the next monthly invoice uses the new
 *     terms.
 *   - Start date: that is a new contract. The old one is terminated, the new
 *     one created, and the caller issues its first-period invoice
 *     (createAndSendStaffContractInvoice), exactly as for a new staff member.
 *
 * It used to terminate and recreate the contract on EVERY save of the staff
 * form, dropping its schedule each time (Julie had five contracts).
 */

const normalizeDays = (value) => (value != null && String(value).trim() !== "" ? String(value).trim() : null);
const sameDay = (a, b) => new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

/**
 * Inside the staff-update transaction.
 * @returns {Promise<{ created: object|null }>}
 *   `created`: a new contract whose first period the caller must invoice.
 */
export async function applyContractEdit(tx, staffId, contract) {
  const data = {
    fixedRent: contract.fixedRent,
    endDate: contract.endDate ? new Date(contract.endDate) : null,
    dueDate: normalizeDays(contract.dueDate),
    notes: contract.notes ?? null,
  };
  const active = await tx.contract.findFirst({
    where: { staffId, status: "ACTIVE", type: "FIXED_RENT" },
    orderBy: { createdAt: "desc" },
    select: { id: true, startDate: true },
  });

  if (active && contract.startDate && sameDay(active.startDate, contract.startDate)) {
    await tx.contract.update({ where: { id: active.id }, data });
    return { created: null };
  }

  await tx.contract.updateMany({ where: { staffId, status: "ACTIVE" }, data: { status: "TERMINATED" } });
  const created = await tx.contract.create({
    data: { staffId, type: "FIXED_RENT", status: "ACTIVE", startDate: new Date(contract.startDate), ...data },
  });
  return { created };
}
