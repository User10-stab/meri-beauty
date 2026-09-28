import { roundMoney } from "@/lib/tax-policy";
import { SALON_PAYMENT_WHERE } from "@/lib/authorization/salon-scope";
import { buildRecettesJournal } from "@/lib/livre-de-recettes/build-recettes-journal";
import { RECETTES_CATEGORIES, RECETTES_CATEGORY_LABELS } from "@/lib/livre-de-recettes/filters";
import { allocateExpenseToPeriod, monthKeyOf, SALON_EXPENSE_CATEGORY_LABELS } from "@/lib/gestion/expenses";

/**
 * The Gestion report: what the salon actually earned over a period, HT.
 *
 *   Chiffre d'affaires HT           ← the Livre de recettes, net of refunds
 * − Coût d'achat des produits vendus ← ProductVariant.costPrice (HT)
 * = Marge brute
 * − Charges du salon               ← SalonExpense (électricité, eau, loyer…)
 * − Dépenses de caisse             ← CashMovement EXPENSE from the Livre de caisse
 * = Bénéfice net
 *
 * Revenue is taken from buildRecettesJournal rather than re-queried, so the
 * turnover here is the Livre de recettes' turnover, to the cent — same salon
 * scope (never an independent's sale), same refund netting, same HT/TVA split.
 *
 * Product cost is today's `costPrice` (OrderItem keeps no cost snapshot),
 * spread over an order's transactions in proportion to the amount each one
 * carries: an acompte carries its share of the cost, and a refund takes its
 * share back out. Ad-hoc service lines have no variant and so no cost.
 *
 * Till expenses carry no VAT breakdown, so their full amount is subtracted —
 * the prudent side of the estimate.
 *
 * With a category filter, the salon-wide costs (charges, till expenses)
 * cannot be attributed to one category: they are still listed, but the net
 * profit is only computed for "Toutes les catégories".
 *
 * @param {import("@prisma/client").PrismaClient} client
 * @param {{ from: string, to: string, fromDate: Date, toDate: Date, category: "ALL"|string }} params
 */
export async function buildGestionReport(client, { from, to, fromDate, toDate, category }) {
  const journal = await buildRecettesJournal(client, { from, to, fromDate, toDate, method: "ALL", category });

  const [orderTransactions, cashExpenseRows, expenseRows] = await Promise.all([
    category === "ALL" || category === "ORDER"
      ? client.transaction.findMany({
          where: {
            id: { in: journal.rows.filter((row) => row.category === "ORDER").map((row) => row.id) },
          },
          select: {
            id: true,
            amount: true,
            payment: {
              select: {
                totalAmount: true,
                order: {
                  select: {
                    items: { select: { quantity: true, variantId: true, variant: { select: { costPrice: true } } } },
                  },
                },
              },
            },
          },
        })
      : [],
    client.cashMovement.findMany({
      where: { type: "EXPENSE", occurredAt: { gte: fromDate, lte: toDate } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { id: true, amount: true, label: true, pieceNumber: true, occurredAt: true },
    }),
    client.salonExpense.findMany({
      where: {
        isDeleted: false,
        OR: [
          { isRecurring: false, date: { gte: fromDate, lte: toDate } },
          { isRecurring: true, date: { lte: toDate }, OR: [{ endDate: null }, { endDate: { gte: startOfMonth(fromDate) } }] },
        ],
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      include: { createdBy: { select: { fullName: true } } },
    }),
  ]);

  // ── Product cost, per transaction ────────────────────────────────────────
  const costByTransaction = new Map();
  let itemsWithoutCost = 0;
  for (const transaction of orderTransactions) {
    const items = transaction.payment?.order?.items ?? [];
    let orderCost = 0;
    for (const item of items) {
      if (!item.variantId) continue; // ad-hoc service line — no stock, no purchase cost
      const unitCost = Number(item.variant?.costPrice ?? 0);
      if (!(unitCost > 0)) itemsWithoutCost += item.quantity;
      orderCost += unitCost * item.quantity;
    }
    const orderTotal = Number(transaction.payment?.totalAmount ?? 0);
    const share = orderTotal > 0 ? Math.min(Number(transaction.amount) / orderTotal, 1) : 0;
    costByTransaction.set(transaction.id, orderCost * share);
  }

  // ── Revenue and cost, per category and per month ─────────────────────────
  const byCategory = new Map();
  const byMonth = new Map();
  const monthBucket = (key) => {
    let bucket = byMonth.get(key);
    if (!bucket) {
      bucket = { month: key, revenueHt: 0, revenueTtc: 0, costHt: 0, chargesHt: 0, cashExpenses: 0 };
      byMonth.set(key, bucket);
    }
    return bucket;
  };

  let revenueHt = 0;
  let revenueTtc = 0;
  let costHt = 0;

  for (const row of journal.rows) {
    const sign = row.isRefund ? -1 : 1;
    const ht = sign * row.amountHt;
    const ttc = sign * row.amountTtc;
    const cost = sign * (costByTransaction.get(row.id) ?? 0);

    revenueHt += ht;
    revenueTtc += ttc;
    costHt += cost;

    let cat = byCategory.get(row.category);
    if (!cat) {
      cat = { category: row.category, label: row.categoryLabel, revenueHt: 0, revenueTtc: 0, costHt: 0, count: 0 };
      byCategory.set(row.category, cat);
    }
    cat.revenueHt += ht;
    cat.revenueTtc += ttc;
    cat.costHt += cost;
    cat.count += 1;

    const month = monthBucket(monthKeyOf(row.paidAt));
    month.revenueHt += ht;
    month.revenueTtc += ttc;
    month.costHt += cost;
  }

  // ── Salon charges ────────────────────────────────────────────────────────
  const expenses = [];
  let chargesHt = 0;
  let chargesTtc = 0;
  const chargesByCategory = {};
  for (const expense of expenseRows) {
    const allocation = allocateExpenseToPeriod(expense, fromDate, toDate);
    if (allocation.amountTtc <= 0) continue;
    chargesHt += allocation.amountHt;
    chargesTtc += allocation.amountTtc;
    chargesByCategory[expense.category] = (chargesByCategory[expense.category] ?? 0) + allocation.amountHt;
    for (const part of allocation.byMonth) monthBucket(part.month).chargesHt += part.amountHt;

    expenses.push({
      id: expense.id,
      category: expense.category,
      categoryLabel: SALON_EXPENSE_CATEGORY_LABELS[expense.category] ?? expense.category,
      label: expense.label,
      amountTtc: Number(expense.amountTtc),
      vatRate: Number(expense.vatRate),
      date: expense.date,
      isRecurring: expense.isRecurring,
      endDate: expense.endDate,
      note: expense.note,
      createdByName: expense.createdBy?.fullName ?? null,
      periodAmountTtc: allocation.amountTtc,
      periodAmountHt: allocation.amountHt,
      prorated: allocation.prorated,
    });
  }

  // ── Till expenses ────────────────────────────────────────────────────────
  let cashExpenses = 0;
  const cashExpenseList = cashExpenseRows.map((movement) => {
    const amount = Number(movement.amount);
    cashExpenses += amount;
    monthBucket(monthKeyOf(movement.occurredAt)).cashExpenses += amount;
    return {
      id: movement.id,
      pieceNumber: movement.pieceNumber,
      label: movement.label,
      occurredAt: movement.occurredAt,
      amount,
    };
  });

  revenueHt = roundMoney(revenueHt);
  revenueTtc = roundMoney(revenueTtc);
  costHt = roundMoney(costHt);
  chargesHt = roundMoney(chargesHt);
  chargesTtc = roundMoney(chargesTtc);
  cashExpenses = roundMoney(cashExpenses);

  const grossMarginHt = roundMoney(revenueHt - costHt);
  const isWholeSalon = category === "ALL";
  const netProfitHt = isWholeSalon ? roundMoney(grossMarginHt - chargesHt - cashExpenses) : null;

  const categoryOrder = RECETTES_CATEGORIES.concat("OTHER");
  const categories = [...byCategory.values()]
    .sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category))
    .map((cat) => {
      const marginHt = roundMoney(cat.revenueHt - cat.costHt);
      return {
        category: cat.category,
        label: cat.label ?? RECETTES_CATEGORY_LABELS[cat.category] ?? cat.category,
        count: cat.count,
        revenueHt: roundMoney(cat.revenueHt),
        revenueTtc: roundMoney(cat.revenueTtc),
        costHt: roundMoney(cat.costHt),
        marginHt,
        marginRate: rate(marginHt, cat.revenueHt),
      };
    });

  const months = [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => {
      const grossHt = roundMoney(m.revenueHt - m.costHt);
      return {
        month: m.month,
        revenueHt: roundMoney(m.revenueHt),
        revenueTtc: roundMoney(m.revenueTtc),
        costHt: roundMoney(m.costHt),
        grossMarginHt: grossHt,
        chargesHt: roundMoney(m.chargesHt),
        cashExpenses: roundMoney(m.cashExpenses),
        netProfitHt: isWholeSalon ? roundMoney(grossHt - m.chargesHt - m.cashExpenses) : null,
      };
    });

  return {
    filters: {
      from,
      to,
      category,
      categoryLabel: category === "ALL" ? "Toutes les catégories" : RECETTES_CATEGORY_LABELS[category] ?? category,
    },
    generatedAt: new Date(),
    truncated: journal.truncated,
    summary: {
      revenueHt,
      revenueTtc,
      revenueVat: roundMoney(revenueTtc - revenueHt),
      costHt,
      grossMarginHt,
      grossMarginRate: rate(grossMarginHt, revenueHt),
      chargesHt,
      chargesTtc,
      cashExpenses,
      netProfitHt,
      netMarginRate: netProfitHt == null ? null : rate(netProfitHt, revenueHt),
      itemsWithoutCost,
      chargesByCategory: Object.entries(chargesByCategory).map(([key, amountHt]) => ({
        category: key,
        label: SALON_EXPENSE_CATEGORY_LABELS[key] ?? key,
        amountHt: roundMoney(amountHt),
      })),
    },
    categories,
    months,
    expenses,
    cashExpenses: cashExpenseList,
  };
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Margin as a % of revenue, one decimal; null when there is no revenue to divide by. */
function rate(part, whole) {
  if (!whole || Math.abs(whole) < 0.005) return null;
  return Math.round((part / whole) * 1000) / 10;
}
