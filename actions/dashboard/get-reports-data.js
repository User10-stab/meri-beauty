"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";

// Same convention as getDashboardStats — a refund is its own ledger event,
// it doesn't erase that the sale happened, so it still counts as revenue.
const REVENUE_STATUSES = ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "REFUNDED"];
const MONTHS_BACK = 6;

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit" }).format(new Date(year, month - 1, 1));
}

/**
 * Cross-cutting business reports — separate from getDashboardStats() (today's
 * snapshot) and getStaffPerformance() (per-staff breakdown). This is the
 * "how's the business doing over time, across every revenue line" view:
 * monthly revenue split by source, best sellers, order/appointment health,
 * customer growth, and promo code effectiveness.
 */
export async function getReportsData() {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.REPORTS)) {
    return { success: false, message: "Accès non autorisé." };
  }

  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - (MONTHS_BACK - 1), 1);

  try {
    const [
      boutiquePayments,
      appointmentPayments,
      workshopPayments,
      formationPayments,
      topProductsRaw,
      orderStatusCounts,
      appointmentStatusCounts,
      newCustomersRaw,
      promoAgg,
      returnsCount,
    ] = await Promise.all([
      prisma.payment.findMany({
        where: { isDeleted: false, status: { in: REVENUE_STATUSES }, paidAt: { gte: rangeStart }, orderId: { not: null } },
        select: { paidAmount: true, paidAt: true },
      }),
      prisma.payment.findMany({
        where: { isDeleted: false, status: { in: REVENUE_STATUSES }, paidAt: { gte: rangeStart }, appointmentId: { not: null } },
        select: { paidAmount: true, paidAt: true },
      }),
      prisma.payment.findMany({
        where: { isDeleted: false, status: { in: REVENUE_STATUSES }, paidAt: { gte: rangeStart }, workshopReservationId: { not: null } },
        select: { paidAmount: true, paidAt: true },
      }),
      prisma.payment.findMany({
        where: { isDeleted: false, status: { in: REVENUE_STATUSES }, paidAt: { gte: rangeStart }, formationReservationId: { not: null } },
        select: { paidAmount: true, paidAt: true },
      }),
      prisma.orderItem.groupBy({
        by: ["productName"],
        where: { order: { createdAt: { gte: rangeStart }, status: { notIn: ["CANCELLED", "EXPIRED"] } } },
        _sum: { quantity: true, unitPrice: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 8,
      }),
      prisma.order.groupBy({
        by: ["status"],
        where: { createdAt: { gte: rangeStart } },
        _count: { _all: true },
      }),
      prisma.appointment.groupBy({
        by: ["status"],
        where: { isDeleted: false, createdAt: { gte: rangeStart } },
        _count: { _all: true },
      }),
      prisma.user.findMany({
        where: { role: "CUSTOMER", isDeleted: false, createdAt: { gte: rangeStart } },
        select: { createdAt: true },
      }),
      prisma.payment.aggregate({
        where: { isDeleted: false, promoCodeId: { not: null }, paidAt: { gte: rangeStart } },
        _sum: { discountAmount: true },
        _count: { _all: true },
      }),
      prisma.returnRequest.count({ where: { requestedAt: { gte: rangeStart } } }),
    ]);

    // ── Monthly revenue by source, one bucket per calendar month so a
    // quiet month still shows up as a zero rather than a gap. ──────────────
    const months = [];
    for (let i = 0; i < MONTHS_BACK; i++) {
      const d = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + i, 1);
      months.push(monthKey(d));
    }
    const buckets = Object.fromEntries(
      months.map((key) => [key, { month: key, label: monthLabel(key), boutique: 0, appointments: 0, workshops: 0, formations: 0 }]),
    );
    function addTo(field, rows) {
      for (const p of rows) {
        const key = monthKey(p.paidAt);
        if (buckets[key]) buckets[key][field] += Number(p.paidAmount);
      }
    }
    addTo("boutique", boutiquePayments);
    addTo("appointments", appointmentPayments);
    addTo("workshops", workshopPayments);
    addTo("formations", formationPayments);
    const revenueByMonth = months.map((key) => buckets[key]);

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

    // ── Top products by units sold, revenue derived from unitPrice*qty sum
    // isn't exact (unitPrice varies per line) but groupBy can only sum each
    // field independently — close enough for a ranking, not an invoice. ────
    const topProducts = topProductsRaw.map((p) => ({
      name: p.productName,
      quantity: p._sum.quantity ?? 0,
    }));

    // ── New customers per month, same bucketing approach as revenue. ──────
    const customerBuckets = Object.fromEntries(months.map((key) => [key, 0]));
    for (const u of newCustomersRaw) {
      const key = monthKey(u.createdAt);
      if (key in customerBuckets) customerBuckets[key] += 1;
    }
    const newCustomersByMonth = months.map((key) => ({ month: key, label: monthLabel(key), count: customerBuckets[key] }));

    return {
      success: true,
      data: {
        totalRevenue,
        revenueByMonth,
        revenueBySource,
        topProducts,
        orderStatusCounts: orderStatusCounts.map((s) => ({ status: s.status, count: s._count._all })),
        appointmentStatusCounts: appointmentStatusCounts.map((s) => ({ status: s.status, count: s._count._all })),
        newCustomersByMonth,
        totalNewCustomers: newCustomersRaw.length,
        promoCode: {
          uses: promoAgg._count._all,
          totalDiscount: Number(promoAgg._sum.discountAmount ?? 0),
        },
        returnsCount,
      },
    };
  } catch (error) {
    console.error("[getReportsData]", error);
    return { success: false, message: "Impossible de charger les rapports." };
  }
}
