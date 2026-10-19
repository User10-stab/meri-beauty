"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { STAFF_PERMISSIONS, canUseSalonTill, hasDashboardPermission } from "@/lib/authorization";
import { COUNTER_SELLABLE_CATALOGUE_STATUSES } from "@/lib/counter/catalogue-availability";
import { OCCUPANCY_KINDS, sessionOccupancyByIds } from "@/lib/reservations/session-occupancy";
import { resolvePayeeForFormationSession, resolvePayeeForStaff } from "@/lib/payments/resolve-payee";
import { formationOffersCustomDates } from "@/lib/formations/custom-date-availability";
import { staffFormationScope, staffSessionScope } from "@/lib/formations/offline-enrolment-scope";

const FORMATION_SELECT = {
  id: true,
  title: true,
  type: true,
  price: true,
  depositPercentage: true,
  capacity: true,
  status: true,
};

/**
 * What the offline-enrolment popup can offer: salon-paid formations with a
 * future session that still has a seat, plus private formations that offer a
 * « date libre » on a salon-paid calendar. An independent trainer's formation
 * is never listed — the salon cannot bank her transfer.
 *
 * @param {{ formationId?: string }} [params]
 */
export async function getOfflineEnrolmentOptions({ formationId } = {}) {
  const actor = await auth();
  if (!actor?.user) return { success: false, message: "Non authentifié.", data: [] };
  const [canUseTill, canReserve] = await Promise.all([
    canUseSalonTill(actor.user),
    hasDashboardPermission(actor.user, STAFF_PERMISSIONS.FORMATION_RESERVATIONS),
  ]);
  if (!canUseTill || !canReserve) return { success: false, message: "Accès non autorisé.", data: [] };

  try {
    const wanted = typeof formationId === "string" && formationId ? formationId : null;
    const now = new Date();
    const sessionScope = staffSessionScope(actor.user);
    const formationScope = staffFormationScope(actor.user);

    const sessions = await prisma.formationSession.findMany({
      where: {
        status: "SCHEDULED",
        customerRequested: false,
        ...(wanted ? { formationId: wanted } : {}),
        AND: [
          { OR: [{ endDate: { gt: now } }, { endDate: null, startDate: { gt: now } }] },
          { formation: { status: { in: COUNTER_SELLABLE_CATALOGUE_STATUSES } } },
          ...(sessionScope ? [sessionScope] : []),
        ],
      },
      orderBy: { startDate: "asc" },
      include: { formation: { select: FORMATION_SELECT } },
    });

    const payees = await Promise.all(
      sessions.map((session) => resolvePayeeForFormationSession(prisma, { sessionId: session.id })),
    );
    const salonSessions = sessions.filter((_, index) => !payees[index].payeeStaffId);
    const occupancy = await sessionOccupancyByIds(prisma, {
      kind: OCCUPANCY_KINDS.FORMATION,
      sessionIds: salonSessions.map((session) => session.id),
    });

    const byFormation = new Map();
    const entryFor = (formation) => {
      if (!byFormation.has(formation.id)) {
        byFormation.set(formation.id, {
          id: formation.id,
          title: formation.title,
          type: formation.type,
          price: Number(formation.price),
          depositPercentage: formation.depositPercentage,
          customDate: false,
          durationMinutes: null,
          sessions: [],
        });
      }
      return byFormation.get(formation.id);
    };

    for (const session of salonSessions) {
      const capacity = session.capacity ?? session.formation.capacity;
      if (!Number.isInteger(capacity) || capacity < 1) continue;
      const remainingSeats = capacity - (occupancy.get(session.id) ?? 0);
      if (remainingSeats <= 0) continue;
      entryFor(session.formation).sessions.push({
        id: session.id,
        startDate: session.startDate,
        endDate: session.endDate,
        capacity,
        remainingSeats,
      });
    }

    const privateFormations = await prisma.formation.findMany({
      where: {
        type: "PRIVATE",
        status: { in: COUNTER_SELLABLE_CATALOGUE_STATUSES },
        ...(wanted ? { id: wanted } : {}),
        ...(formationScope ?? {}),
      },
      select: {
        ...FORMATION_SELECT,
        duration: true,
        animatorId: true,
        createdById: true,
        animator: { select: { staffId: true } },
      },
    });
    for (const formation of privateFormations) {
      if (!(await formationOffersCustomDates(prisma, formation))) continue;
      const payee = await resolvePayeeForStaff(prisma, { staffId: formation.animator?.staffId });
      if (payee.payeeStaffId) continue;
      const entry = entryFor(formation);
      entry.customDate = true;
      entry.durationMinutes = formation.duration;
    }

    const data = [...byFormation.values()]
      .filter((entry) => entry.sessions.length > 0 || entry.customDate)
      .sort((a, b) => a.title.localeCompare(b.title, "fr"));
    return { success: true, data };
  } catch (error) {
    console.error("[getOfflineEnrolmentOptions]", error);
    return { success: false, message: "Impossible de charger les formations.", data: [] };
  }
}
