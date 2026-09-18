"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { summarizePaymentAmounts } from "@/lib/payments/reconcile-reservation-refund";
import { resolveSalonScope, SALON_PAYMENT_WHERE } from "@/lib/authorization/salon-scope";
import {
  BANK_METHODS,
  CASH_METHODS,
  METHOD_LABELS,
  REPORT_PERIODS,
  normalizeReportMonths,
} from "@/lib/reports-filters";

// Same convention as getDashboardStats — a refund is its own ledger event,
// it doesn't erase that the sale happened, so it still counts as revenue.
const REVENUE_STATUSES = ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "REFUNDED"];

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit", timeZone: "Europe/Brussels" }).format(new Date(year, month - 1, 1));
}

/**
 * Cross-cutting business reports — separate from getDashboardStats() (today's
 * snapshot). There is no per-staff breakdown anywhere, by design. This is the
 * "how's the business doing over time, across every revenue line" view.
 *
 * Two money figures come out of here and they answer different questions.
 * `totalRevenue` is summed from Payment.paidAmount — how much was earned.
 * `cashCollected` / `bankCollected` are summed from the Transaction ledger,
 * because only a Transaction knows whether the money went into the drawer or
 * onto a bank statement. They are close but need not tie out exactly (a
 * Payment can exist with no Transaction row), so they are reported side by
 * side rather than one being presented as a breakdown of the other.
 *
 * Every figure is the SALON's only (lib/authorization/salon-scope.js): the
 * ADMIN/OWNER accounts, Marie Mercier (her VAT number is the salon's), the
 * online sales nobody rang up, and the salon's own ateliers and formations.
 * Every other practitioner is legally independent — her takings are hers,
 * are never added into these totals, and there is no filter to open them.
 *
 * @param {{ months?: number }} [filters]
 *   `months` must be one of REPORT_PERIODS; anything else falls back to the
 *   default rather than letting a hand-edited query string scan the whole
 *   ledger.
 */
export async function getReportsData({ months } = {}) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.REPORTS)) {
    return { success: false, message: "Accès non autorisé." };
  }

  const monthsBack = normalizeReportMonths(months);
  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

  try {
    const scope = await resolveSalonScope(prisma);
    const salonPayment = SALON_PAYMENT_WHERE;
    // An Order is the salon's when a salon account rang it up, or nobody did
    // (the customer's own online purchase). Order.createdByStaffId → User.id.
    const salonOrder = { OR: [{ createdByStaffId: { in: scope.salonUserIds } }, { createdByStaffId: null }] };

    const [
      boutiquePayments,
      appointmentPayments,
      workshopPayments,
      formationPayments,
      methodRows,
      topProductsRaw,
      orderStatusCounts,
      appointmentStatusCounts,
      newCustomersRaw,
      promoAgg,
      returnsCount,
    ] = await Promise.all([
      prisma.payment.findMany({
        where: {
          isDeleted: false,
          status: { in: REVENUE_STATUSES },
          paidAt: { gte: rangeStart },
          orderId: { not: null },
          order: salonOrder,
          ...salonPayment,
        },
        select: { paidAmount: true, paidAt: true, transactions: { select: { transactionType: true, amount: true } } },
      }),
      prisma.payment.findMany({
        where: {
          isDeleted: false,
          status: { in: REVENUE_STATUSES },
          paidAt: { gte: rangeStart },
          appointmentId: { not: null },
          // Marie's (and any employee's) appointments — never an independent's.
          ...salonPayment,
        },
        select: { paidAmount: true, paidAt: true, transactions: { select: { transactionType: true, amount: true } } },
      }),
      // Ateliers and formations — except the ones an independent animates,
      // whose seats are her own sales.
      prisma.payment.findMany({
        where: { isDeleted: false, status: { in: REVENUE_STATUSES }, paidAt: { gte: rangeStart }, workshopReservationId: { not: null }, ...salonPayment },
        select: { paidAmount: true, paidAt: true, transactions: { select: { transactionType: true, amount: true } } },
      }),
      prisma.payment.findMany({
        where: { isDeleted: false, status: { in: REVENUE_STATUSES }, paidAt: { gte: rangeStart }, formationReservationId: { not: null }, ...salonPayment },
        select: { paidAmount: true, paidAt: true, transactions: { select: { transactionType: true, amount: true } } },
      }),

      // Cash vs bank. Grouped with transactionType so a refund can be netted
      // off its own method instead of inflating takings — a €50 card sale
      // refunded on the terminal is €0 through the bank, not €100 of movement.
      prisma.transaction.groupBy({
        by: ["method", "transactionType"],
        where: {
          isDeleted: false,
          paidAt: { gte: rangeStart },
          payment: salonPayment,
        },
        _sum: { amount: true },
      }),

      prisma.orderItem.groupBy({
        by: ["productName"],
        where: {
          order: {
            createdAt: { gte: rangeStart },
            // SETTLED_AT_COUNTER: its items are counted once, on the counter
            // sale that replaced it.
            status: { notIn: ["CANCELLED", "EXPIRED", "SETTLED_AT_COUNTER"] },
            ...salonOrder,
          },
        },
        _sum: { quantity: true, unitPrice: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 8,
      }),
      prisma.order.groupBy({
        by: ["status"],
        where: { createdAt: { gte: rangeStart }, ...salonOrder },
        _count: { _all: true },
      }),
      prisma.appointment.groupBy({
        by: ["status"],
        where: {
          isDeleted: false,
          createdAt: { gte: rangeStart },
          staffId: { in: scope.salonStaffIds },
        },
        _count: { _all: true },
      }),

      // A count of accounts, not money — a new customer belongs to the salon,
      // not to whoever happened to serve them first.
      prisma.user.findMany({
        where: { role: "CUSTOMER", isDeleted: false, createdAt: { gte: rangeStart } },
        select: { createdAt: true },
      }),
      prisma.payment.aggregate({
        where: { isDeleted: false, promoCodeId: { not: null }, paidAt: { gte: rangeStart }, ...salonPayment },
        _sum: { discountAmount: true },
        _count: { _all: true },
      }),
      prisma.returnRequest.count({ where: { requestedAt: { gte: rangeStart }, order: salonOrder } }),
    ]);

    // ── Monthly revenue by source, one bucket per calendar month so a
    // quiet month still shows up as a zero rather than a gap. ──────────────
    const months_ = [];
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + i, 1);
      months_.push(monthKey(d));
    }
    const buckets = Object.fromEntries(
      months_.map((key) => [key, { month: key, label: monthLabel(key), boutique: 0, appointments: 0, workshops: 0, formations: 0 }]),
    );
    function addTo(field, rows) {
      for (const p of rows) {
        const key = monthKey(p.paidAt);
        if (buckets[key]) buckets[key][field] += summarizePaymentAmounts(p).netCollectedAmount;
      }
    }
    addTo("boutique", boutiquePayments);
    addTo("appointments", appointmentPayments);
    addTo("workshops", workshopPayments);
    addTo("formations", formationPayments);
    const revenueByMonth = months_.map((key) => buckets[key]);

    const totalRevenue = revenueByMonth.reduce(
      (sum, m) => sum + m.boutique + m.appointments + m.workshops + m.formations,
      0,
    );
    const revenueBySource = [
      { label: "Boutique", value: revenueByMonth.reduce((s, m) => s + m.boutique, 0) },
      { label: "Rendez-vous", value: revenueByMonth.reduce((s, m) => s + m.appointments, 0) },
      { label: "Ateliers", value: revenueByMonth.reduce((s, m) => s + m.workshops, 0) },
      { label: "Formations", value: revenueByMonth.reduce((s, m) => s + m.formations, 0) },
    ];

    // ── Cash vs bank ──────────────────────────────────────────────────────
    const netByMethod = { CASH: 0, CARD: 0, ONLINE: 0 };
    const refundByMethod = { CASH: 0, CARD: 0, ONLINE: 0 };
    for (const row of methodRows) {
      const amount = Number(row._sum.amount ?? 0);
      if (!(row.method in netByMethod)) continue;
      if (row.transactionType === "REFUND") {
        netByMethod[row.method] -= amount;
        refundByMethod[row.method] += amount;
      } else {
        netByMethod[row.method] += amount;
      }
    }
    const round2 = (value) => Math.round(value * 100) / 100;
    const cashCollected = round2(CASH_METHODS.reduce((sum, m) => sum + netByMethod[m], 0));
    const bankCollected = round2(BANK_METHODS.reduce((sum, m) => sum + netByMethod[m], 0));
    const collectionByMethod = Object.keys(METHOD_LABELS).map((method) => ({
      method,
      label: METHOD_LABELS[method],
      // Which side of the reconciliation this lands on: the drawer, or the
      // bank statement.
      settlement: CASH_METHODS.includes(method) ? "cash" : "bank",
      net: round2(netByMethod[method]),
      refunded: round2(refundByMethod[method]),
    }));

    // ── New customers per month, same bucketing approach as revenue. ──────
    const customerBuckets = Object.fromEntries(months_.map((key) => [key, 0]));
    for (const u of newCustomersRaw) {
      const key = monthKey(u.createdAt);
      if (key in customerBuckets) customerBuckets[key] += 1;
    }
    const newCustomersByMonth = months_.map((key) => ({ month: key, label: monthLabel(key), count: customerBuckets[key] }));

    return {
      success: true,
      data: {
        filters: {
          months: monthsBack,
          periods: REPORT_PERIODS,
        },
        rangeStart,
        totalRevenue,
        revenueByMonth,
        revenueBySource,
        cashCollected,
        bankCollected,
        collectionByMethod,
        topProducts: topProductsRaw.map((p) => ({ name: p.productName, quantity: p._sum.quantity ?? 0 })),
        orderStatusCounts: orderStatusCounts.map((s) => ({ status: s.status, count: s._count._all })),
        appointmentStatusCounts: appointmentStatusCounts.map((s) => ({ status: s.status, count: s._count._all })),
        newCustomersByMonth,
        totalNewCustomers: newCustomersRaw.length,
        promoCode: { uses: promoAgg._count._all, totalDiscount: Number(promoAgg._sum.discountAmount ?? 0) },
        returnsCount,
      },
    };
  } catch (error) {
    console.error("[getReportsData]", error);
    return { success: false, message: "Impossible de charger les rapports." };
  }
}
