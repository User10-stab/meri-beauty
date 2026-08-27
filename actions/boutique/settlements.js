"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  ROLES,
  STAFF_PERMISSIONS,
  getStaffId,
  hasDashboardPermission,
  isAdminRole,
} from "@/lib/authorization";

/**
 * What the counter still has to find, in one list: a customer to check in,
 * or a balance to collect. Often the same person.
 *
 * Money already had three on-site settlement paths — completeAppointment for
 * rendez-vous, settleReservation (via completeWorkshopReservation /
 * completeFormationReservation) for ateliers and formations — but each lived
 * behind a different screen. Check-in had its own scanner, on yet another
 * screen. Someone standing at the till with a customer had to guess which
 * one, in another tab, or scan on a separate device entirely.
 *
 * This action only *finds* things. It deliberately records nothing: both
 * check-in (actions/activities/check-in.js) and settling (the three actions
 * above) stay exactly where they were, so the invoice, the receipt e-mail,
 * the cash-session attachment, the audit trail and the "confirm you actually
 * received the money" attestation all stay in one place instead of being
 * reimplemented here.
 */

const RESULT_LIMIT = 40;

/**
 * The till is its own permission, and so is each thing being found. A
 * cashier who may run the register but holds no APPOINTMENTS capability must
 * not see (or act on) a rendez-vous — the underlying action would refuse it
 * anyway, but a list full of rows that error on click is its own bug.
 */
async function resolveScope() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.POINT_OF_SALE))) {
    return { error: "Accès non autorisé." };
  }

  const [canAppointments, canWorkshops, canFormations] = await Promise.all([
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.FORMATION_RESERVATIONS),
  ]);

  // Mirrors authorizeAppointmentAction: a STAFF member sees only their own
  // calendar here. Listing someone else's rendez-vous here would leak the
  // customer name and the amount owed even though acting on it would then
  // be refused downstream.
  let ownStaffId = null;
  if (!isAdminRole(session.user.role) && session.user.role === ROLES.STAFF) {
    ownStaffId = await getStaffId(session);
    if (!ownStaffId) return { error: "Profil staff introuvable." };
  }

  return { session, canAppointments, canWorkshops, canFormations, ownStaffId };
}

function nameSearchTerms(query) {
  return (query ?? "").trim().split(/\s+/).filter(Boolean);
}

async function findCustomerIdsByName(query) {
  const terms = nameSearchTerms(query);
  if (terms.length === 0) return null;

  // Resolve people first, rather than relying on three separate nested
  // relation filters. This keeps the name shown on the counter ticket and
  // the name lookup on the same User record, and lets "Client Test" match
  // regardless of casing or extra spaces in the search box.
  const customers = await prisma.user.findMany({
    where: {
      isDeleted: false,
      AND: terms.map((term) => ({
        fullName: { contains: term, mode: "insensitive" },
      })),
    },
    select: { id: true },
    take: RESULT_LIMIT,
  });

  return customers.map((customer) => customer.id);
}

function todayWindow() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { gte: start, lte: end };
}

/**
 * One search, two reasons to use it: finding someone to check in (a dead
 * phone battery, a QR that never arrived) and finding a balance still owed.
 * Scanning a code is the fast path (actions/counter/lookup.js); this is the
 * fallback — the one thing a scanner can never do is find someone who lost
 * their code entirely.
 *
 * With no name typed, this shows only *today's* confirmed bookings — the
 * counter's daily agenda, the same role the old "outstanding balances" list
 * played. Once staff types a name, every confirmed booking matching it comes
 * back regardless of date: chasing an old debt, or checking someone in for a
 * booking that starts later today, does not care what day it technically is.
 */
export async function searchCounterTickets(query) {
  const scope = await resolveScope();
  if (scope.error) return { success: false, message: scope.error, data: [] };

  const value = query?.trim() ?? "";
  const dateFilter = value ? undefined : todayWindow();

  try {
    const customerIds = await findCustomerIdsByName(value);
    const searchResults = await Promise.allSettled([
      scope.canAppointments
        ? prisma.appointment.findMany({
            where: {
              status: "CONFIRMED",
              isDeleted: false,
              ...(scope.ownStaffId ? { staffId: scope.ownStaffId } : {}),
              ...(customerIds ? { userId: { in: customerIds } } : {}),
              ...(dateFilter ? { startTime: dateFilter } : {}),
            },
            select: {
              id: true,
              startTime: true,
              checkedInAt: true,
              user: { select: { fullName: true } },
              staffService: { select: { service: { select: { name: true } } } },
              payment: { select: { remainingAmount: true, totalAmount: true, paidAmount: true } },
            },
            orderBy: { startTime: "desc" },
            take: RESULT_LIMIT,
          })
        : [],

      scope.canWorkshops
        ? prisma.workshopReservation.findMany({
            where: {
              status: "CONFIRMED",
              ...(customerIds ? { customerId: { in: customerIds } } : {}),
              ...(dateFilter ? { session: { startDate: dateFilter } } : {}),
            },
            select: {
              id: true,
              seatsCount: true,
              checkedInSeats: true,
              customer: { select: { fullName: true } },
              session: { select: { startDate: true, workshop: { select: { title: true, type: true } } } },
              payment: { select: { remainingAmount: true, totalAmount: true, paidAmount: true } },
            },
            orderBy: { session: { startDate: "desc" } },
            take: RESULT_LIMIT,
          })
        : [],

      scope.canFormations
        ? prisma.formationReservation.findMany({
            where: {
              status: "CONFIRMED",
              ...(customerIds ? { customerId: { in: customerIds } } : {}),
              ...(dateFilter ? { session: { startDate: dateFilter } } : {}),
            },
            select: {
              id: true,
              seatsCount: true,
              checkedInSeats: true,
              customer: { select: { fullName: true } },
              session: { select: { startDate: true, formation: { select: { title: true } } } },
              payment: { select: { remainingAmount: true, totalAmount: true, paidAmount: true } },
            },
            orderBy: { session: { startDate: "desc" } },
            take: RESULT_LIMIT,
          })
        : [],
    ]);

    const labels = ["rendez-vous", "ateliers", "formations"];
    searchResults.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(`[searchCounterTickets] recherche ${labels[index]} indisponible`, result.reason);
      }
    });

    // One temporarily unavailable domain must not erase valid results from
    // the other two. This matters during an additive migration rollout: the
    // appointment check-in columns can be pending while workshop/formation
    // tickets are already live and fully searchable.
    const appointments = searchResults[0].status === "fulfilled" ? searchResults[0].value : [];
    const workshops = searchResults[1].status === "fulfilled" ? searchResults[1].value : [];
    const formations = searchResults[2].status === "fulfilled" ? searchResults[2].value : [];

    const enabledSearches = [scope.canAppointments, scope.canWorkshops, scope.canFormations];
    const hasSuccessfulEnabledSearch = searchResults.some(
      (result, index) => enabledSearches[index] && result.status === "fulfilled"
    );
    if (!hasSuccessfulEnabledSearch) {
      return { success: false, message: "Impossible de charger les résultats.", data: [] };
    }

    const rows = [
      ...appointments.map((appointment) => ({
        kind: "appointment",
        id: appointment.id,
        customerName: appointment.user?.fullName ?? "—",
        label: appointment.staffService?.service?.name ?? "Prestation",
        occurredAt: appointment.startTime,
        balanceDue: Number(appointment.payment?.remainingAmount ?? 0),
        totalAmount: Number(appointment.payment?.totalAmount ?? 0),
        checkedIn: Boolean(appointment.checkedInAt),
      })),
      ...workshops.map((reservation) => ({
        kind: "workshop",
        id: reservation.id,
        customerName: reservation.customer?.fullName ?? "—",
        label: `${reservation.session.workshop.title} (${reservation.seatsCount} place${reservation.seatsCount > 1 ? "s" : ""})`,
        activityType: reservation.session.workshop.type,
        occurredAt: reservation.session.startDate,
        balanceDue: Number(reservation.payment?.remainingAmount ?? 0),
        totalAmount: Number(reservation.payment?.totalAmount ?? 0),
        checkedIn: reservation.checkedInSeats >= reservation.seatsCount,
      })),
      ...formations.map((reservation) => ({
        kind: "formation",
        id: reservation.id,
        customerName: reservation.customer?.fullName ?? "—",
        label: `${reservation.session.formation.title} (${reservation.seatsCount} place${reservation.seatsCount > 1 ? "s" : ""})`,
        occurredAt: reservation.session.startDate,
        balanceDue: Number(reservation.payment?.remainingAmount ?? 0),
        totalAmount: Number(reservation.payment?.totalAmount ?? 0),
        checkedIn: reservation.checkedInSeats >= reservation.seatsCount,
      })),
    ];

    // Nearest to "now" first, whether that moment already passed or is still
    // to come — a natural order for both today's agenda (empty query) and a
    // name search spanning many dates (the relevant booking is rarely the
    // customer's oldest one).
    const now = Date.now();
    rows.sort((a, b) => Math.abs(new Date(a.occurredAt) - now) - Math.abs(new Date(b.occurredAt) - now));

    return { success: true, data: rows.slice(0, RESULT_LIMIT) };
  } catch (error) {
    console.error("[searchCounterTickets]", error);
    return { success: false, message: "Impossible de charger les résultats.", data: [] };
  }
}
