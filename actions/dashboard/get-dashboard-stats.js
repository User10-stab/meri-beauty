"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/appointment-status";
import { hasPermission, DASHBOARD_PERMISSIONS, getDashboardPermissions, isAdminRole, STAFF_PERMISSIONS } from "@/lib/authorization";
import { getLowStockVariants } from "@/actions/boutique/stock";
import { summarizePaymentAmounts } from "@/lib/payments/reconcile-reservation-refund";
import { getCurrentStaffId } from "@/lib/route-protection";
import { staffCustomerRelationshipFilters } from "@/lib/staff-customer-scope";

// Revenue = money that has actually landed, regardless of a later partial/
// full refund — a refund is its own ledger event, it doesn't erase that the
// sale happened. PENDING/FAILED/REFUND_PENDING carry no paidAmount worth
// counting yet.
const REVENUE_STATUSES = ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "REFUNDED"];

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Aggregate data for the dashboard home page — replaces the NextAdmin
 * template's mock "Payments Overview / Top Channels / Used Devices" widgets
 * (visitor counts, ad channels — none of which apply to a salon booking
 * app) with real numbers pulled from Payment/Appointment/Order/User.
 */
export async function getDashboardStats() {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.DASHBOARD_HOME)) {
    return { success: false, message: "Accès non autorisé." };
  }

  const isAdmin = isAdminRole(session.user.role);
  const permissions = await getDashboardPermissions(session.user);
  const staffId = isAdmin ? null : await getCurrentStaffId();
  const canSeeAppointments = isAdmin || permissions.includes(STAFF_PERMISSIONS.APPOINTMENTS);
  const canSeeCustomers = isAdmin || permissions.includes(STAFF_PERMISSIONS.CUSTOMERS);
  const canSeeStock = isAdmin || permissions.includes(STAFF_PERMISSIONS.BOUTIQUE_STOCK);
  const canSeeOrders = isAdmin || permissions.includes(STAFF_PERMISSIONS.ORDERS);
  const appointmentScope = staffId ? { staffService: { staffId } } : {};
  const customerRelationshipFilters = staffId
    ? staffCustomerRelationshipFilters({ staffId, staffUserId: session.user.id })
    : null;

  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // 7-day window incl. today

  try {
    const [
      revenueThisMonth,
      appointmentsToday,
      newCustomersThisMonth,
      lowStock,
      upcomingAppointments,
      recentOrders,
      revenueLast7Days,
    ] = await Promise.all([
      isAdmin ? prisma.payment.findMany({
        where: { isDeleted: false, status: { in: REVENUE_STATUSES }, paidAt: { gte: startOfMonth } },
        select: { paidAmount: true, transactions: { select: { transactionType: true, amount: true } } },
      }) : Promise.resolve([]),
      canSeeAppointments ? prisma.appointment.count({
        where: {
          isDeleted: false,
          date: { gte: today, lt: tomorrow },
          status: { in: [...ACTIVE_APPOINTMENT_STATUSES, "COMPLETED"] },
          ...appointmentScope,
        },
      }) : Promise.resolve(0),
      canSeeCustomers ? prisma.user.count({
        where: {
          role: "CUSTOMER",
          isDeleted: false,
          createdAt: { gte: startOfMonth },
          ...(customerRelationshipFilters ? { OR: customerRelationshipFilters } : {}),
        },
      }) : Promise.resolve(0),
      canSeeStock ? getLowStockVariants() : Promise.resolve({ success: true, data: [] }),
      canSeeAppointments ? prisma.appointment.findMany({
        where: {
          isDeleted: false,
          status: { in: ACTIVE_APPOINTMENT_STATUSES },
          startTime: { gte: now },
          ...appointmentScope,
        },
        orderBy: { startTime: "asc" },
        take: 5,
        select: {
          id: true,
          startTime: true,
          status: true,
          user: { select: { fullName: true } },
          staffService: {
            select: {
              service: { select: { name: true } },
              staff: { select: { user: { select: { fullName: true } } } },
            },
          },
        },
      }) : Promise.resolve([]),
      canSeeOrders ? prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          user: { select: { fullName: true } },
        },
      }) : Promise.resolve([]),
      isAdmin ? prisma.payment.findMany({
        where: { isDeleted: false, status: { in: REVENUE_STATUSES }, paidAt: { gte: sevenDaysAgo } },
        select: {
          paidAmount: true,
          paidAt: true,
          transactions: { select: { transactionType: true, amount: true } },
        },
      }) : Promise.resolve([]),
    ]);

    // Bucket the last 7 days' revenue by calendar day so the trend chart
    // has one point per day even for days with zero payments.
    const dailyTotals = new Map();
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      dailyTotals.set(dateKey(d), 0);
    }
    for (const p of revenueLast7Days) {
      const key = dateKey(p.paidAt);
      if (dailyTotals.has(key)) {
        dailyTotals.set(key, dailyTotals.get(key) + summarizePaymentAmounts(p).netCollectedAmount);
      }
    }
    const revenueTrend = Array.from(dailyTotals.entries()).map(([date, total]) => ({ date, total }));

    return {
      success: true,
      data: {
        revenueThisMonth: revenueThisMonth.reduce(
          (sum, payment) => sum + summarizePaymentAmounts(payment).netCollectedAmount,
          0,
        ),
        appointmentsToday,
        newCustomersThisMonth,
        lowStockCount: lowStock.data?.length ?? 0,
        revenueTrend,
        upcomingAppointments: upcomingAppointments.map((a) => ({
          id: a.id,
          startTime: a.startTime.toISOString(),
          status: a.status,
          customerName: a.user?.fullName ?? "—",
          serviceName: a.staffService?.service?.name ?? "Service",
          staffName: a.staffService?.staff?.user?.fullName ?? "—",
        })),
        recentOrders: recentOrders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          totalAmount: Number(o.totalAmount),
          createdAt: o.createdAt.toISOString(),
          customerName: o.user?.fullName ?? "—",
        })),
        lowStockItems: (lowStock.data ?? []).slice(0, 5).map((v) => ({
          id: v.id,
          productName: v.productName,
          name: v.name,
          availableQuantity: v.availableQuantity,
          lowStockThreshold: v.lowStockThreshold,
        })),
      },
    };
  } catch (error) {
    console.error("[getDashboardStats]", error);
    return { success: false, message: "Impossible de charger les statistiques du tableau de bord." };
  }
}
