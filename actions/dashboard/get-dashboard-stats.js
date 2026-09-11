"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/appointment-status";
import { hasPermission, DASHBOARD_PERMISSIONS, getDashboardPermissions, isAdminRole, STAFF_PERMISSIONS } from "@/lib/authorization";
import { getLowStockVariants } from "@/actions/boutique/stock";
import { summarizePaymentAmounts } from "@/lib/payments/reconcile-reservation-refund";
import { getCurrentStaffId } from "@/lib/route-protection";
import { staffCustomerRelationshipFilters } from "@/lib/staff-customer-scope";
import { getOrderOverdueReason } from "@/lib/orders/overdue-rules";

// Same candidate statuses as lib/orders/notify-stale-fulfilment.js — the only
// statuses getOrderOverdueReason can ever flag. Keep in sync with that file.
const OVERDUE_CANDIDATE_STATUSES = ["PENDING_PICKUP", "PAID", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED"];

// The timestamp getOrderOverdueReason actually judged each reason against —
// mirrors the reason -> field mapping in lib/orders/overdue-rules.js.
function overdueSinceDate(order, reason) {
  if (reason === "NOT_COLLECTED") return order.readyForPickupAt;
  if (reason === "NOT_CONFIRMED_DELIVERED") return order.shippedAt;
  return order.createdAt;
}

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

function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthLabelOf(year, monthIndex) {
  const label = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(
    new Date(year, monthIndex, 1)
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Aggregate data for the dashboard home page — replaces the NextAdmin
 * template's mock "Payments Overview / Top Channels / Used Devices" widgets
 * (visitor counts, ad channels — none of which apply to a salon booking
 * app) with real numbers pulled from Payment/Appointment/Order/User.
 *
 * Global filters (admin dashboard):
 * @param {object} [filters]
 * @param {string|null} [filters.staffId] - OWNER/ADMIN only: recalculate every
 *   statistic for this staff member and hide boutique/order sections (product
 *   and order figures are salon-wide and never attributed to a staff member).
 *   Ignored for non-admin callers, who keep their own appointment scope.
 * @param {string|null} [filters.month] - "YYYY-MM": recalculate every
 *   date-based statistic for this month. Defaults to the current month.
 */
export async function getDashboardStats({ staffId = null, month = null } = {}) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.DASHBOARD_HOME)) {
    return { success: false, message: "Accès non autorisé." };
  }

  const isAdmin = isAdminRole(session.user.role);
  const permissions = await getDashboardPermissions(session.user);

  // ── Month window ───────────────────────────────────────────────────────
  const now = new Date();
  const validMonth = typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const activeMonth = validMonth ? month : monthKeyOf(now);
  const [monthYear, monthNumber] = activeMonth.split("-").map(Number);
  const monthStart = new Date(monthYear, monthNumber - 1, 1);
  const monthEnd = new Date(monthYear, monthNumber, 1);
  const isCurrentMonth = activeMonth === monthKeyOf(now);
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // ── Viewed staff (admin-only filter) ───────────────────────────────────
  // Non-admin callers keep their own scope: a passed staffId is ignored so a
  // staff member can never pull another member's figures through this action.
  let viewedStaff = null;
  if (isAdmin && staffId) {
    const target = await prisma.staff.findUnique({
      where: { id: staffId },
      select: {
        id: true,
        userId: true,
        isDeleted: true,
        user: { select: { fullName: true } },
      },
    });
    if (target && !target.isDeleted) {
      viewedStaff = { id: target.id, userId: target.userId, fullName: target.user.fullName };
    }
  }
  const staffView = Boolean(viewedStaff);

  const ownStaffId = isAdmin ? null : await getCurrentStaffId();
  const effectiveStaffId = staffView ? viewedStaff.id : ownStaffId;
  const canSeeAppointments = isAdmin || permissions.includes(STAFF_PERMISSIONS.APPOINTMENTS);
  const canSeeCustomers = isAdmin || permissions.includes(STAFF_PERMISSIONS.CUSTOMERS);
  const canSeeStock = isAdmin || permissions.includes(STAFF_PERMISSIONS.BOUTIQUE_STOCK);
  const canSeeOrders = isAdmin || permissions.includes(STAFF_PERMISSIONS.ORDERS);
  const appointmentScope = effectiveStaffId ? { staffService: { staffId: effectiveStaffId } } : {};
  // In staff view, customers are the viewed member's customers (same
  // relationship rule as a staff member's own dashboard).
  const customerRelationshipFilters = staffView
    ? staffCustomerRelationshipFilters({ staffId: viewedStaff.id, staffUserId: viewedStaff.userId })
    : ownStaffId
      ? staffCustomerRelationshipFilters({ staffId: ownStaffId, staffUserId: session.user.id })
      : null;

  // Staff revenue = appointment (reservation) payments for that member's
  // services. Boutique/order payments are salon-wide and excluded here —
  // the boutique/order sections are hidden in staff view for the same reason.
  const revenueWhere = {
    isDeleted: false,
    status: { in: REVENUE_STATUSES },
    paidAt: { gte: monthStart, lt: monthEnd },
    ...(staffView ? { appointment: { staffService: { staffId: viewedStaff.id } } } : {}),
  };

  // "Today" only exists in the current month — for another month the card
  // counts that month's appointments instead (same statuses).
  const appointmentCountWhere = {
    isDeleted: false,
    status: { in: [...ACTIVE_APPOINTMENT_STATUSES, "COMPLETED"] },
    ...(isCurrentMonth
      ? { date: { gte: today, lt: tomorrow } }
      : { date: { gte: monthStart, lt: monthEnd } }),
    ...appointmentScope,
  };

  // Past months have no "upcoming" appointments — list that month's instead.
  const appointmentListWhere = {
    isDeleted: false,
    status: { in: ACTIVE_APPOINTMENT_STATUSES },
    ...(isCurrentMonth
      ? { startTime: { gte: now } }
      : { date: { gte: monthStart, lt: monthEnd } }),
    ...appointmentScope,
  };

  // Boutique/order sections are salon-wide: hidden in staff view, and the
  // order list follows the month filter in global view.
  const showBoutique = !staffView;

  try {
    const [
      monthPayments,
      appointmentsCount,
      newCustomersInMonth,
      lowStock,
      listedAppointments,
      ordersInMonth,
      overdueCandidates,
      staffOptions,
    ] = await Promise.all([
      // Single month query feeds both the revenue total and the daily chart.
      isAdmin ? prisma.payment.findMany({
        where: revenueWhere,
        select: { paidAmount: true, paidAt: true, transactions: { select: { transactionType: true, amount: true } } },
      }) : Promise.resolve([]),
      canSeeAppointments ? prisma.appointment.count({
        where: appointmentCountWhere,
      }) : Promise.resolve(0),
      canSeeCustomers ? prisma.user.count({
        where: {
          role: "CUSTOMER",
          isDeleted: false,
          createdAt: { gte: monthStart, lt: monthEnd },
          ...(customerRelationshipFilters ? { OR: customerRelationshipFilters } : {}),
        },
      }) : Promise.resolve(0),
      showBoutique && canSeeStock ? getLowStockVariants() : Promise.resolve({ success: true, data: [] }),
      canSeeAppointments ? prisma.appointment.findMany({
        where: appointmentListWhere,
        orderBy: { startTime: "asc" },
        take: 5,
        select: {
          id: true,
          startTime: true,
          status: true,
          user: { select: { fullName: true } },
          staffService: {
            select: {
              staffId: true,
              service: { select: { name: true } },
              staff: { select: { user: { select: { fullName: true } } } },
            },
          },
        },
      }) : Promise.resolve([]),
      showBoutique && canSeeOrders ? prisma.order.findMany({
        where: { createdAt: { gte: monthStart, lt: monthEnd } },
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
      showBoutique && canSeeOrders ? prisma.order.findMany({
        where: { status: { in: OVERDUE_CANDIDATE_STATUSES } },
        select: {
          id: true,
          orderNumber: true,
          fulfilmentMode: true,
          status: true,
          createdAt: true,
          readyForPickupAt: true,
          shippedAt: true,
          collectedAt: true,
          user: { select: { fullName: true } },
        },
      }) : Promise.resolve([]),
      // Filter dropdown options (admins only — one cheap query).
      isAdmin ? prisma.staff.findMany({
        where: { isDeleted: false, user: { isDeleted: false } },
        orderBy: { user: { fullName: "asc" } },
        select: { id: true, user: { select: { fullName: true } } },
      }) : Promise.resolve([]),
    ]);

    const overdueOrders = overdueCandidates
      .map((order) => ({ order, reason: getOrderOverdueReason(order, now) }))
      .filter(({ reason }) => reason !== null)
      .map(({ order, reason }) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        reason,
        customerName: order.user?.fullName ?? "—",
        sinceDate: overdueSinceDate(order, reason),
      }))
      .sort((a, b) => new Date(a.sinceDate).getTime() - new Date(b.sinceDate).getTime());

    // Bucket the selected month's revenue by calendar day so the trend chart
    // has one point per day even for days with zero payments.
    const daysInMonth = new Date(monthYear, monthNumber, 0).getDate();
    const dailyTotals = new Map();
    for (let day = 1; day <= daysInMonth; day++) {
      dailyTotals.set(`${activeMonth}-${String(day).padStart(2, "0")}`, 0);
    }
    for (const p of monthPayments) {
      if (!p.paidAt) continue;
      const key = dateKey(p.paidAt);
      if (dailyTotals.has(key)) {
        dailyTotals.set(key, dailyTotals.get(key) + summarizePaymentAmounts(p).netCollectedAmount);
      }
    }
    const revenueTrend = Array.from(dailyTotals.entries()).map(([date, total]) => ({ date, total }));

    return {
      success: true,
      data: {
        revenueThisMonth: monthPayments.reduce(
          (sum, payment) => sum + summarizePaymentAmounts(payment).netCollectedAmount,
          0,
        ),
        appointmentsToday: appointmentsCount,
        newCustomersThisMonth: newCustomersInMonth,
        lowStockCount: lowStock.data?.length ?? 0,
        revenueTrend,
        upcomingAppointments: listedAppointments.map((a) => ({
          id: a.id,
          startTime: a.startTime.toISOString(),
          status: a.status,
          customerName: a.user?.fullName ?? "—",
          serviceName: a.staffService?.service?.name ?? "Service",
          staffId: a.staffService?.staffId ?? null,
          staffName: a.staffService?.staff?.user?.fullName ?? "—",
        })),
        recentOrders: ordersInMonth.map((o) => ({
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
        overdueOrdersCount: overdueOrders.length,
        // Capped well above the ~3 cards visible at once in the dashboard
        // carousel — enough to scroll through without re-fetching, not
        // unbounded like the underlying query.
        overdueOrders: overdueOrders.slice(0, 24).map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          reason: o.reason,
          customerName: o.customerName,
          sinceDate: o.sinceDate.toISOString(),
        })),
        // ── Global filter state (drives labels + section visibility) ──
        activeMonth,
        monthLabel: monthLabelOf(monthYear, monthNumber - 1),
        isCurrentMonth,
        staffView,
        viewedStaff: viewedStaff ? { id: viewedStaff.id, fullName: viewedStaff.fullName } : null,
        staffOptions: staffOptions.map((s) => ({ id: s.id, fullName: s.user.fullName })),
      },
    };
  } catch (error) {
    console.error("[getDashboardStats]", error);
    return { success: false, message: "Impossible de charger les statistiques du tableau de bord." };
  }
}
