"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { STAFF_PERMISSIONS, hasDashboardPermission } from "@/lib/authorization";
import { searchCounterTickets } from "@/actions/boutique/settlements";
import { searchCounterServices } from "@/actions/counter/walk-in-service";
import { searchPointOfSaleProducts } from "@/actions/boutique/point-of-sale";
import { OCCUPANCY_KINDS, sessionOccupancyByIds } from "@/lib/reservations/session-occupancy";

/**
 * The one search behind the counter's omnibar: typing three letters must
 * find a booking to check in or settle, a boutique pickup, a service to
 * sell as a walk-in, an atelier/formation session with seats to sell on the
 * spot, or a product to ring up — all from one box.
 *
 * This does not replace the four domain searches it calls — each keeps its
 * own permission guard and its own shape, because each already had one
 * (searchCounterTickets, searchCounterServices, searchPointOfSaleProducts)
 * before this file existed. Re-running auth() per domain at counter QPS is
 * irrelevant, and it keeps every domain's gating in exactly one place.
 *
 * Only the catalogue-session lookup (an atelier/formation with open seats)
 * is new: nothing before this searched "sessions you could sell a seat on"
 * as a first-class result.
 */

const SESSION_RESULT_LIMIT = 10;

function startOfToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

async function canSearchSessions() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  const [canUseTill, canWorkshops, canFormations] = await Promise.all([
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.POINT_OF_SALE),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.FORMATION_RESERVATIONS),
  ]);
  if (!canUseTill) return { error: "Accès non autorisé." };
  return { canWorkshops, canFormations };
}

/**
 * Ateliers/événements and formations with a session still open to sell a
 * seat on. Gated on *_RESERVATIONS, not WORKSHOPS/FORMATIONS: finding a
 * session here is the first step of selling a reservation, the same
 * capability a counter booking is created under, not the capability that
 * manages the catalogue itself.
 */
async function searchCounterSessions(query) {
  const guard = await canSearchSessions();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  const value = query?.trim();
  if (!value || value.length < 3) return { success: true, data: [] };

  try {
    const [workshopSessions, formationSessions] = await Promise.all([
      guard.canWorkshops
        ? prisma.workshopSession.findMany({
            where: {
              status: "SCHEDULED",
              startDate: { gte: startOfToday() },
              workshop: { status: "PUBLISHED", title: { contains: value, mode: "insensitive" } },
            },
            select: {
              id: true,
              startDate: true,
              capacity: true,
              workshop: { select: { id: true, title: true, type: true, price: true, depositPercentage: true, capacity: true } },
            },
            orderBy: { startDate: "asc" },
            take: SESSION_RESULT_LIMIT,
          })
        : [],
      guard.canFormations
        ? prisma.formationSession.findMany({
            where: {
              status: "SCHEDULED",
              startDate: { gte: startOfToday() },
              formation: { status: "PUBLISHED", title: { contains: value, mode: "insensitive" } },
            },
            select: {
              id: true,
              startDate: true,
              capacity: true,
              formation: { select: { id: true, title: true, price: true, depositPercentage: true, capacity: true } },
            },
            orderBy: { startDate: "asc" },
            take: SESSION_RESULT_LIMIT,
          })
        : [],
    ]);

    const [workshopOccupancy, formationOccupancy] = await Promise.all([
      sessionOccupancyByIds(prisma, {
        kind: OCCUPANCY_KINDS.WORKSHOP,
        sessionIds: workshopSessions.map((session) => session.id),
      }),
      sessionOccupancyByIds(prisma, {
        kind: OCCUPANCY_KINDS.FORMATION,
        sessionIds: formationSessions.map((session) => session.id),
      }),
    ]);

    const rows = [
      ...workshopSessions.map((session) => {
        const capacity = session.capacity ?? session.workshop.capacity;
        const taken = workshopOccupancy.get(session.id) ?? 0;
        return {
          kind: "workshop",
          catalogueId: session.workshop.id,
          sessionId: session.id,
          title: session.workshop.title,
          activityType: session.workshop.type,
          startDate: session.startDate,
          unitPrice: Number(session.workshop.price),
          depositPercentage: session.workshop.depositPercentage,
          capacity,
          seatsAvailable: Math.max(0, capacity - taken),
        };
      }),
      ...formationSessions.map((session) => {
        const capacity = session.capacity ?? session.formation.capacity;
        const taken = formationOccupancy.get(session.id) ?? 0;
        return {
          kind: "formation",
          catalogueId: session.formation.id,
          sessionId: session.id,
          title: session.formation.title,
          activityType: null,
          startDate: session.startDate,
          unitPrice: Number(session.formation.price),
          depositPercentage: session.formation.depositPercentage,
          capacity,
          seatsAvailable: Math.max(0, capacity - taken),
        };
      }),
    ];

    rows.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    return { success: true, data: rows.slice(0, SESSION_RESULT_LIMIT) };
  } catch (error) {
    console.error("[searchCounterSessions]", error);
    return { success: false, message: "Impossible de rechercher les sessions.", data: [] };
  }
}

/**
 * Fans the same typed query out to every domain and tags each row with the
 * result-row `type` the counter UI dispatches on: BOOKING/PICKUP go to a
 * fiche, SERVICE/SESSION go to the booking composer, PRODUCT goes straight
 * to the cart. One domain being unavailable (a permission the cashier
 * lacks, or a transient failure) never erases the others' results.
 */
export async function searchCounter(query) {
  const value = query?.trim() ?? "";
  if (value.length < 3) return { success: true, data: [] };

  const [tickets, services, sessions, products] = await Promise.allSettled([
    searchCounterTickets(value),
    searchCounterServices(value),
    searchCounterSessions(value),
    searchPointOfSaleProducts(value),
  ]);

  const labels = ["bookings", "services", "sessions", "products"];
  [tickets, services, sessions, products].forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`[searchCounter] recherche ${labels[index]} indisponible`, result.reason);
    }
  });

  const ticketRows = tickets.status === "fulfilled" && tickets.value.success ? tickets.value.data : [];
  const serviceRows = services.status === "fulfilled" && services.value.success ? services.value.data : [];
  const sessionRows = sessions.status === "fulfilled" && sessions.value.success ? sessions.value.data : [];
  const productRows = products.status === "fulfilled" && products.value.success ? products.value.data : [];

  const hasAnySuccess =
    (tickets.status === "fulfilled" && tickets.value.success) ||
    (services.status === "fulfilled" && services.value.success) ||
    (sessions.status === "fulfilled" && sessions.value.success) ||
    (products.status === "fulfilled" && products.value.success);
  if (!hasAnySuccess) {
    return { success: false, message: "Impossible de charger les résultats.", data: [] };
  }

  return {
    success: true,
    data: [
      ...ticketRows.map((row) => ({ type: "BOOKING", ...row })),
      ...serviceRows.map((row) => ({ type: "SERVICE", ...row })),
      ...sessionRows.map((row) => ({ type: "SESSION", ...row })),
      ...productRows.map((row) => ({ type: "PRODUCT", ...row })),
    ],
  };
}
