"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { summarizePaymentAmounts } from "@/lib/payments/reconcile-reservation-refund";
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
 * snapshot) and getStaffPerformance() (per-staff breakdown). This is the
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
 * @param {{ months?: number, staffId?: string|null }} [filters]
 *   `months` must be one of REPORT_PERIODS; anything else falls back to the
 *   default rather than letting a hand-edited query string scan the whole
 *   ledger. `staffId` scopes to one practitioner — see staffScoped below.
 */
export async function getReportsData({ months, staffId } = {}) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.REPORTS)) {
    return { success: false, message: "Accès non autorisé." };
  }

  const monthsBack = normalizeReportMonths(months);
  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

  try {
    // The staff directory drives the filter dropdown, and resolving the
    // selected one gives both ids the filter needs: Appointment keys on
    // Staff.id, Order.createdByStaffId keys on User.id.
    const staffList = await prisma.staff.findMany({
      where: { isDeleted: false, user: { isDeleted: false } },
      orderBy: { user: { fullName: "asc" } },
      select: { id: true, isActive: true, user: { select: { id: true, fullName: true } } },
    });
    const staffOptions = staffList.map((s) => ({
      id: s.id,
      fullName: s.user.fullName,
      isActive: s.isActive,
    }));

    const selectedStaff = staffId ? staffList.find((s) => s.id === staffId) ?? null : null;
    // An unknown id must not silently widen the report back to everyone.
    if (staffId && !selectedStaff) {
      return { success: false, message: "Membre du personnel introuvable." };
    }
    const staffScoped = Boolean(selectedStaff);
    const staffUserId = selectedStaff?.user.id ?? null;

    // Ateliers and formations are run by the Animator directory, which has no
    // link to Staff — there is no honest way to attribute them to a
    // practitioner, so a staff-scoped report leaves them out entirely rather
    // than showing everyone's.

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
          ...(staffUserId ? { order: { createdByStaffId: staffUserId } } : {}),
        },
        select: { paidAmount: true, paidAt: true, transactions: { select: { transactionType: true, amount: true } } },
      }),
      prisma.payment.findMany({
        where: {
          isDeleted: false,
          status: { in: REVENUE_STATUSES },
          paidAt: { gte: rangeStart },
          appointmentId: { not: null },
          ...(selectedStaff ? { appointment: { staffId: selectedStaff.id } } : {}),
        },
        select: { paidAmount: true, paidAt: true, transactions: { select: { transactionType: true, amount: true } } },
      }),
      staffScoped
        ? []
        : prisma.payment.findMany({
            where: { isDeleted: false, status: { in: REVENUE_STATUSES }, paidAt: { gte: rangeStart }, workshopReservationId: { not: null } },
            select: { paidAmount: true, paidAt: true, transactions: { select: { transactionType: true, amount: true } } },
          }),
      staffScoped
        ? []
        : prisma.payment.findMany({
            where: { isDeleted: false, status: { in: REVENUE_STATUSES }, paidAt: { gte: rangeStart }, formationReservationId: { not: null } },
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
          ...(staffScoped
            ? {
                payment: {
                  OR: [
                    { appointment: { staffId: selectedStaff.id } },
                    { order: { createdByStaffId: staffUserId } },
                  ],
                },
              }
            : {}),
        },
        _sum: { amount: true },
      }),

      prisma.orderItem.groupBy({
        by: ["productName"],
        where: {
          order: {
            createdAt: { gte: rangeStart },
            status: { notIn: ["CANCELLED", "EXPIRED"] },
            ...(staffUserId ? { createdByStaffId: staffUserId } : {}),
          },
        },
        _sum: { quantity: true, unitPrice: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 8,
      }),
      prisma.order.groupBy({
        by: ["status"],
        where: { createdAt: { gte: rangeStart }, ...(staffUserId ? { createdByStaffId: staffUserId } : {}) },
        _count: { _all: true },
      }),
      prisma.appointment.groupBy({
        by: ["status"],
        where: {
          isDeleted: false,
          createdAt: { gte: rangeStart },
          ...(selectedStaff ? { staffId: selectedStaff.id } : {}),
        },
        _count: { _all: true },
      }),

      // Not attributable to a practitioner — a new customer belongs to the
      // salon, not to whoever happened to serve them first. Skipped rather
      // than shown unfiltered next to filtered figures.
      staffScoped
        ? []
        : prisma.user.findMany({
            where: { role: "CUSTOMER", isDeleted: false, createdAt: { gte: rangeStart } },
            select: { createdAt: true },
          }),
      staffScoped
        ? null
        : prisma.payment.aggregate({
            where: { isDeleted: false, promoCodeId: { not: null }, paidAt: { gte: rangeStart } },
            _sum: { discountAmount: true },
            _count: { _all: true },
          }),
      staffScoped ? null : prisma.returnRequest.count({ where: { requestedAt: { gte: rangeStart } } }),
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
          staffId: selectedStaff?.id ?? null,
          staffName: selectedStaff?.user.fullName ?? null,
          periods: REPORT_PERIODS,
          staffOptions,
        },
        // Tells the client to hide the cards that cannot honestly be scoped
        // to one practitioner rather than showing salon-wide numbers beside
        // filtered ones.
        staffScoped,
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
        promoCode: promoAgg
          ? { uses: promoAgg._count._all, totalDiscount: Number(promoAgg._sum.discountAmount ?? 0) }
          : null,
        returnsCount,
      },
    };
  } catch (error) {
    console.error("[getReportsData]", error);
    return { success: false, message: "Impossible de charger les rapports." };
  }
}
