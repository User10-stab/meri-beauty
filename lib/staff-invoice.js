import { prisma } from "@/lib/prisma";
import { buildRentalDescription } from "@/lib/invoicing";
import { createPendingRent, issueRentInvoiceNow } from "@/lib/staff-rent-payment";

/**
 * The first rent period of a new staff contract.
 *
 * Records the rent due — a StaffMonthlyInvoice row with a PENDING Payment —
 * then issues its invoice straight away, unpaid, with its échéance, so it can
 * be sent before the staff member pays (lib/staff-rent-payment.js). The admin
 * accepts the transfer from the Factures page once it arrived, which only
 * records the money. If the invoice is refused, the rent stays recorded and
 * the Factures page offers « Émettre la facture ».
 *
 * - Agreed price: contract.fixedRent (VAT-inclusive); a 0 € contract owes nothing.
 * - Due date: contract.dueDate days after contract.startDate, otherwise 7 days.
 * - Idempotent: the row's @@unique([staffId, billingYear, billingMonth]) also
 *   keeps the monthly engine from billing the same period again.
 * - Initializes nextInvoiceDate on both Contract and Staff (startDate + 1 month).
 *
 * The name is historical (callers in actions/staff/*).
 * Must be called AFTER the staff+contract transaction has committed.
 *
 * @param {{ contract: { id: string, fixedRent: any, startDate: Date, endDate?: Date|null, dueDate?: Date|string|null, staffId?: string, rentalType?: string } }} params
 * @returns {Promise<{ invoice: null, pendingRent: object|null, emailed: false, error?: string }>}
 */
export async function createAndSendStaffContractInvoice({ contract }) {
  if (!contract?.id || contract?.fixedRent == null || !contract?.startDate) {
    console.warn("[staff-invoice] missing contract data, skipping rent", { contractId: contract?.id });
    return { invoice: null, pendingRent: null, emailed: false, error: "Données manquantes pour la facturation" };
  }

  const amount = Number(contract.fixedRent);
  if (!Number.isFinite(amount) || amount < 0) {
    console.warn("[staff-invoice] invalid fixedRent", { contractId: contract.id, fixedRent: contract.fixedRent });
    return { invoice: null, pendingRent: null, emailed: false, error: "Montant du contrat invalide" };
  }

  const startDate = new Date(contract.startDate);
  const parseDueDays = (v) => {
    if (v == null || String(v).trim() === "") return null;
    const n = Number(String(v).trim());
    return Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 365 ? n : null;
  };
  const dueDateFrom = (value) => {
    const days = parseDueDays(value);
    if (days != null) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + days);
      return d;
    }
    if (value) {
      const legacy = new Date(value);
      if (!isNaN(legacy.getTime())) return legacy;
    }
    return null;
  };

  // Enrichment from the contract row itself (best-effort): the cabin/space
  // type lives on RentalRequest, and the caller may not pass staffId/dueDate.
  let rentalType = contract.rentalType ?? null;
  let staffId = contract.staffId ?? null;
  let contractDueDate = contract.dueDate ?? null;
  try {
    const enriched = await prisma.contract.findUnique({
      where: { id: contract.id },
      select: { dueDate: true, staffId: true, rentalRequest: { select: { rentalType: true } } },
    });
    rentalType = enriched?.rentalRequest?.rentalType ?? rentalType;
    staffId = staffId ?? enriched?.staffId ?? null;
    if ((contractDueDate == null || String(contractDueDate).trim() === "") && enriched?.dueDate) contractDueDate = enriched.dueDate;
  } catch (err) {
    console.error("[staff-invoice] contract enrichment failed (non-blocking)", err);
  }
  if (!staffId) {
    return { invoice: null, pendingRent: null, emailed: false, error: "Staff introuvable pour ce contrat" };
  }

  const dueDate = dueDateFrom(contractDueDate) ?? new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextInvoiceDate = calculateNextInvoiceDate(startDate);
  const billingYear = startDate.getUTCFullYear();
  const billingMonth = startDate.getUTCMonth() + 1;

  let pendingRent = null;
  try {
    pendingRent = await prisma.$transaction(async (tx) => {
      // A 0 € contract owes nothing: schedule only.
      const row =
        amount > 0
          ? await createPendingRent(tx, {
              staffId,
              contractId: contract.id,
              billingYear,
              billingMonth,
              amount,
              lineDescription: buildRentalDescription({ startDate: contract.startDate, endDate: contract.endDate ?? null, rentalType }),
              dueDate,
            })
          : null;

      await tx.contract.update({ where: { id: contract.id }, data: { nextInvoiceDate } });
      await tx.staff.update({ where: { id: staffId }, data: { nextInvoiceDate } });
      return row;
    });
  } catch (err) {
    // The period is already recorded (a retry, or the monthly engine got there first).
    if (err?.code === "P2002") {
      console.log(`[staff-invoice] rent for contract ${contract.id} (${billingYear}-${billingMonth}) already recorded — skipping`);
      return { invoice: null, pendingRent: null, emailed: false };
    }
    console.error("[staff-invoice] recording the rent due failed", err);
    return { invoice: null, pendingRent: null, emailed: false, error: err.message ?? "Erreur lors de l'enregistrement du loyer" };
  }

  let invoice = null;
  if (pendingRent) {
    try {
      invoice = await issueRentInvoiceNow(pendingRent.id);
    } catch (err) {
      console.error(`[staff-invoice] rent for contract ${contract.id} recorded, but its invoice could not be issued`, err);
      return { invoice: null, pendingRent, emailed: false, error: err.userMessage ?? err.message ?? "Facture non émise" };
    }
  }

  return { invoice, pendingRent, emailed: false };
}

/**
 * Calculate next invoice date = startDate + 1 month, with month-end handling.
 * If the billing day doesn't exist in the target month, uses the last day.
 * @param {Date} startDate
 * @returns {Date}
 */
function calculateNextInvoiceDate(startDate) {
  const billingDay = startDate.getUTCDate();
  const year = startDate.getUTCFullYear();
  const month = startDate.getUTCMonth();

  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear += 1;
  }

  const lastDayOfNextMonth = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  const dayToUse = Math.min(billingDay, lastDayOfNextMonth);

  return new Date(Date.UTC(nextYear, nextMonth, dayToUse, 0, 0, 0));
}
