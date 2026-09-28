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

/** Days between two local calendar dates, both included — DST-proof. */
function inclusiveDays(start, end) {
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((b - a) / 86_400_000) + 1;
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
 * at all. A monthly charge counts once per covered month, prorated by day for
 * a month the period only partly covers (1–15 September = 15/30 of the
 * September rent) — otherwise a half-month view would carry a whole rent.
 *
 * @param {{ amountTtc: number|string, vatRate: number|string, date: Date|string,
 *   isRecurring: boolean, endDate?: Date|string|null }} expense
 * @returns {{ amountTtc: number, amountHt: number, prorated: boolean,
 *   byMonth: Array<{ month: string, amountTtc: number, amountHt: number }> }}
 */
export function allocateExpenseToPeriod(expense, fromDate, toDate) {
  const monthly = Number(expense.amountTtc);
  const rate = Number(expense.vatRate);
  const monthlyHt = calculateVatTotals(monthly, rate).totalExclVat;
  const date = new Date(expense.date);
  const byMonth = [];

  if (!expense.isRecurring) {
    if (date < fromDate || date > toDate) return { amountTtc: 0, amountHt: 0, prorated: false, byMonth };
    byMonth.push({ month: monthKeyOf(date), amountTtc: roundMoney(monthly), amountHt: monthlyHt });
    return { amountTtc: roundMoney(monthly), amountHt: monthlyHt, prorated: false, byMonth };
  }

  const runStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = expense.endDate ? new Date(expense.endDate) : null;
  // Through the last day of the end month.
  const runEnd = end ? new Date(end.getFullYear(), end.getMonth() + 1, 0) : null;

  let prorated = false;
  let cursor = new Date(Math.max(runStart.getTime(), new Date(fromDate.getFullYear(), fromDate.getMonth(), 1).getTime()));
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);

  while (cursor <= toDate && (!runEnd || cursor <= runEnd)) {
    const monthStart = cursor;
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const overlapStart = new Date(Math.max(monthStart.getTime(), fromDate.getTime(), runStart.getTime()));
    const overlapEnd = new Date(Math.min(monthEnd.getTime(), toDate.getTime(), runEnd ? runEnd.getTime() : Infinity));

    if (overlapStart <= overlapEnd) {
      const covered = inclusiveDays(overlapStart, overlapEnd);
      const total = inclusiveDays(monthStart, monthEnd);
      const share = covered / total;
      if (covered < total) prorated = true;
      byMonth.push({
        month: monthKeyOf(monthStart),
        amountTtc: roundMoney(monthly * share),
        amountHt: roundMoney(monthlyHt * share),
      });
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return {
    amountTtc: roundMoney(byMonth.reduce((sum, m) => sum + m.amountTtc, 0)),
    amountHt: roundMoney(byMonth.reduce((sum, m) => sum + m.amountHt, 0)),
    prorated,
    byMonth,
  };
}
