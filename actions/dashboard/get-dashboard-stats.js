"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/appointment-status";
import { hasPermission, DASHBOARD_PERMISSIONS, getDashboardPermissions, isAdminRole, isTillCashOperator, STAFF_PERMISSIONS } from "@/lib/authorization";
import { getLowStockVariants } from "@/actions/boutique/stock";
import { getCurrentStaffId } from "@/lib/route-protection";
import { staffCustomerRelationshipFilters } from "@/lib/staff-customer-scope";
import { SALON_PAYMENT_WHERE } from "@/lib/authorization/salon-scope";
import { getOrderOverdueReason } from "@/lib/orders/overdue-rules";
import { BANK_METHODS, CASH_METHODS, METHOD_LABELS } from "@/lib/reports-filters";

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

// Which Payment foreign key says what was sold. Anything else the salon was
// paid for (an invoice sale with free lines, …) lands in "Autres" so the
// breakdown always adds up to the revenue card.
const REVENUE_SOURCES = [
  { key: "boutique", label: "Boutique", field: "orderId" },
  { key: "appointments", label: "Rendez-vous", field: "appointmentId" },
  { key: "workshops", label: "Ateliers", field: "workshopReservationId" },
  { key: "formations", label: "Formations", field: "formationReservationId" },
];

function round2(value) {
  return Math.round(value * 100) / 100;
}

// A REFUND is a negative entry, like in the livre de recettes.
function signedAmount(transaction) {
  const amount = Number(transaction.amount ?? 0);
  return transaction.transactionType === "REFUND" ? -amount : amount;
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
 * There is no staff filter. Every practitioner other than Marie is legally
 * independent, so the admin dashboard shows the salon's figures only and has
 * no way to open an independent's; a staff member keeps her own scope.
 *
 * @param {object} [filters]
 * @param {string|null} [filters.month] - "YYYY-MM": recalculate every
 *   date-based statistic for this month. Defaults to the current month.
 */
export async function getDashboardStats({ month = null } = {}) {
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

  const ownStaffId = isAdmin ? null : await getCurrentStaffId();
  const effectiveStaffId = ownStaffId;
  const canSeeAppointments = isAdmin || permissions.includes(STAFF_PERMISSIONS.APPOINTMENTS);
  const canSeeCustomers = isAdmin || permissions.includes(STAFF_PERMISSIONS.CUSTOMERS);
  const canSeeStock = isAdmin || permissions.includes(STAFF_PERMISSIONS.BOUTIQUE_STOCK);
  const canSeeOrders = isAdmin || isTillCashOperator(session.user);
  const appointmentScope = effectiveStaffId ? { staffService: { staffId: effectiveStaffId } } : {};
  const customerRelationshipFilters = ownStaffId
    ? staffCustomerRelationshipFilters({ staffId: ownStaffId, staffUserId: session.user.id })
    : null;

  // The SALON's revenue, not everyone's. An independent practitioner's sale
  // (Payment.payeeStaffId set) is hers, under her own VAT number, and is never
  // added to the salon's "chiffre d'affaires". Revenue is admin-only, so a
  // non-admin never runs this query. See lib/authorization/salon-scope.js.
  //
  // Revenue is counted the way the livre de recettes counts it: by the day the
  // money MOVED (Transaction.paidAt), a refund being a negative entry on the
  // day it was paid out. Counting by Payment.paidAt put a refund in September
  // on an August sale into neither month's net (prod, Sept 2026: 7 323,30 €
  // here against 7 308,30 € in the livre).
  const revenueWhere = {
    isDeleted: false,
    paidAt: { gte: monthStart, lt: monthEnd },
    payment: SALON_PAYMENT_WHERE,
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


  // Every boutique Order is the salon's — online, or rung up at the till by
  // anyone (Marie, an admin, or a staff member granted CAISSE). Who rang it up
  // never moves boutique revenue out of the salon's books.
  const salonOrder = {};

  try {
    const [
      monthTransactions,
      appointmentsCount,
      newCustomersInMonth,
      lowStock,
      listedAppointments,
      ordersInMonth,
      overdueCandidates,
      methodRows,
      topProductsRaw,
    ] = await Promise.all([
      // Single month query feeds the revenue total, the daily chart and the
      // split by activity.
      isAdmin ? prisma.transaction.findMany({
        where: revenueWhere,
        select: {
          amount: true,
          transactionType: true,
          paidAt: true,
          payment: {
            select: {
              orderId: true,
              appointmentId: true,
              workshopReservationId: true,
              formationReservationId: true,
            },
          },
        },
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
      canSeeStock ? getLowStockVariants() : Promise.resolve({ success: true, data: [] }),
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
      canSeeOrders ? prisma.order.findMany({
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
      canSeeOrders ? prisma.order.findMany({
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
      // Cash vs bank, from the Transaction ledger — only a Transaction knows
      // whether the money went into the drawer or onto a bank statement.
      // Grouped with transactionType so a refund is netted off its own method
      // instead of inflating takings.
      isAdmin ? prisma.transaction.groupBy({
        by: ["method", "transactionType"],
        where: {
          isDeleted: false,
          paidAt: { gte: monthStart, lt: monthEnd },
          payment: SALON_PAYMENT_WHERE,
        },
        _sum: { amount: true },
      }) : Promise.resolve([]),
      isAdmin ? prisma.orderItem.groupBy({
        by: ["productName"],
        where: {
          order: {
            createdAt: { gte: monthStart, lt: monthEnd },
            // SETTLED_AT_COUNTER: its items are counted once, on the counter
            // sale that replaced it.
            status: { notIn: ["CANCELLED", "EXPIRED", "SETTLED_AT_COUNTER"] },
            ...salonOrder,
          },
        },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 8,
      }) : Promise.resolve([]),
    ]);

    // ── Revenue by activity — same payments, same net figure as the card. ──
    const sourceTotals = { boutique: 0, appointments: 0, workshops: 0, formations: 0, other: 0 };
    for (const t of monthTransactions) {
      const source = REVENUE_SOURCES.find((s) => t.payment?.[s.field] != null);
      sourceTotals[source ? source.key : "other"] += signedAmount(t);
    }
    const revenueBySource = REVENUE_SOURCES.map((s) => ({ key: s.key, label: s.label, value: round2(sourceTotals[s.key]) }));
    if (round2(sourceTotals.other) !== 0) {
      revenueBySource.push({ key: "other", label: "Autres", value: round2(sourceTotals.other) });
    }

    // ── Cash vs bank ──────────────────────────────────────────────────────
    const netByMethod = Object.fromEntries(Object.keys(METHOD_LABELS).map((m) => [m, 0]));
    const refundByMethod = { ...netByMethod };
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
    const collectionByMethod = Object.keys(METHOD_LABELS).map((method) => ({
      method,
      label: METHOD_LABELS[method],
      // Which side of the reconciliation this lands on: the drawer, or the
      // bank statement.
      settlement: CASH_METHODS.includes(method) ? "cash" : "bank",
      net: round2(netByMethod[method]),
      refunded: round2(refundByMethod[method]),
    }));

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
    for (const t of monthTransactions) {
      if (!t.paidAt) continue;
      const key = dateKey(t.paidAt);
      if (dailyTotals.has(key)) {
        dailyTotals.set(key, round2(dailyTotals.get(key) + signedAmount(t)));
      }
    }
    const revenueTrend = Array.from(dailyTotals.entries()).map(([date, total]) => ({ date, total }));

    return {
      success: true,
      data: {
        revenueThisMonth: round2(monthTransactions.reduce((sum, t) => sum + signedAmount(t), 0)),
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
        revenueBySource,
        collectionByMethod,
        cashCollected: round2(CASH_METHODS.reduce((sum, m) => sum + netByMethod[m], 0)),
        bankCollected: round2(BANK_METHODS.reduce((sum, m) => sum + netByMethod[m], 0)),
        topProducts: topProductsRaw.map((p) => ({ name: p.productName, quantity: p._sum.quantity ?? 0 })),
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
      },
    };
  } catch (error) {
    console.error("[getDashboardStats]", error);
    return { success: false, message: "Impossible de charger les statistiques du tableau de bord." };
  }
}
