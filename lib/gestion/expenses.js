/**
 * The salon's own running costs (model SalonExpense): vocabulary, input
 * validation and how a charge is spread over a reporting period.
 *
 * Pure and framework-free — shared by the Gestion server actions, the report
 * builder and the client form, and unit-tested against plain objects. Not a
 * "use server" module (see lib/livre-de-recettes/filters.js for that trap).
 */

import { roundMoney, calculateVatTotals } from "@/lib/tax-policy";

export const SALON_EXPENSE_CATEGORIES = ["RENT", "ELECTRICITY", "WATER", "INTERNET", "OTHER"];

export const SALON_EXPENSE_CATEGORY_LABELS = {
  RENT: "Loyer du salon",
  ELECTRICITY: "Électricité",
  WATER: "Eau",
  INTERNET: "Internet",
  OTHER: "Autre",
};

/** Belgian VAT rates a bill can carry (a lease is usually 0 %). */
export const SALON_EXPENSE_VAT_RATES = [0, 6, 12, 21];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_ONLY = /^\d{4}-\d{2}$/;

function parseDateOnly(value) {
  if (typeof value !== "string" || !DATE_ONLY.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  // Process TZ is Europe/Brussels (instrumentation.js): a Brussels-local midnight.
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== month - 1) return null;
  return date;
}

function parseMonth(value) {
  if (typeof value !== "string" || !MONTH_ONLY.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  if (month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}

/**
 * Validates the Gestion form. A one-off charge is dated by `date`
 * ("YYYY-MM-DD"); a recurring one runs monthly from `startMonth` through
 * `endMonth` ("YYYY-MM", optional = still running). Both are stored as the
 * first day of their month — the whole month is what a monthly charge covers.
 *
 * @returns {{ data?: object, errors?: Record<string, string> }}
 */
export function parseSalonExpenseInput(input = {}) {
  const errors = {};

  const category = SALON_EXPENSE_CATEGORIES.includes(input.category) ? input.category : null;
  if (!category) errors.category = "Choisissez un type de charge.";

  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label) errors.label = "Indiquez un libellé.";
  else if (label.length > 200) errors.label = "Le libellé ne peut pas dépasser 200 caractères.";

  const amount = Number(input.amountTtc);
  if (!Number.isFinite(amount) || amount <= 0) errors.amountTtc = "Le montant doit être strictement positif.";
  else if (amount > 1_000_000) errors.amountTtc = "Montant trop élevé.";

  const vatRate = Number(input.vatRate);
  if (!SALON_EXPENSE_VAT_RATES.includes(vatRate)) errors.vatRate = "Taux de TVA invalide.";

  const isRecurring = input.isRecurring === true;
  let date = null;
  let endDate = null;

  if (isRecurring) {
    date = parseMonth(input.startMonth);
    if (!date) errors.startMonth = "Indiquez le premier mois.";
    if (input.endMonth) {
      endDate = parseMonth(input.endMonth);
      if (!endDate) errors.endMonth = "Mois de fin invalide.";
      else if (date && endDate < date) errors.endMonth = "Le mois de fin précède le premier mois.";
    }
  } else {
    date = parseDateOnly(input.date);
    if (!date) errors.date = "Indiquez la date de la facture.";
  }

  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 500) errors.note = "La note ne peut pas dépasser 500 caractères.";

  if (Object.keys(errors).length > 0) return { errors };

  return {
    data: {
      category,
      label,
      amountTtc: roundMoney(amount),
      vatRate,
      date,
      isRecurring,
      endDate,
      note: note || null,
    },
  };
}

/** "YYYY-MM" of a local date — the key months are grouped by. */
export function monthKeyOf(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * How much of one charge falls inside [fromDate, toDate], split by month.
 *
 * A one-off charge counts in full if its date is inside the period, else not
 * at all. A monthly charge counts in FULL for every month the period touches
 * while it runs — never prorated by day (user's call, 2026-09-28: a rent is
 * owed for the whole month, so 1–28 September still carries the whole
 * September rent).
 *
 * @param {{ amountTtc: number|string, vatRate: number|string, date: Date|string,
 *   isRecurring: boolean, endDate?: Date|string|null }} expense
 * @returns {{ amountTtc: number, amountHt: number,
 *   byMonth: Array<{ month: string, amountTtc: number, amountHt: number }> }}
 */
export function allocateExpenseToPeriod(expense, fromDate, toDate) {
  const monthly = roundMoney(Number(expense.amountTtc));
  const monthlyHt = calculateVatTotals(monthly, Number(expense.vatRate)).totalExclVat;
  const date = new Date(expense.date);
  const byMonth = [];

  if (!expense.isRecurring) {
    if (date < fromDate || date > toDate) return { amountTtc: 0, amountHt: 0, byMonth };
    byMonth.push({ month: monthKeyOf(date), amountTtc: monthly, amountHt: monthlyHt });
    return { amountTtc: monthly, amountHt: monthlyHt, byMonth };
  }

  // Month granularity throughout: first day of the charge's first month,
  // first day of its last month (open-ended when null).
  const firstMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = expense.endDate ? new Date(expense.endDate) : null;
  const lastMonth = end ? new Date(end.getFullYear(), end.getMonth(), 1) : null;
  const periodFirstMonth = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);

  let cursor = firstMonth > periodFirstMonth ? firstMonth : periodFirstMonth;
  while (cursor <= toDate && (!lastMonth || cursor <= lastMonth)) {
    byMonth.push({ month: monthKeyOf(cursor), amountTtc: monthly, amountHt: monthlyHt });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return {
    amountTtc: roundMoney(monthly * byMonth.length),
    amountHt: roundMoney(monthlyHt * byMonth.length),
    byMonth,
  };
}
