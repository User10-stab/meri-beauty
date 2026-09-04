import { prisma } from "@/lib/prisma";
import { ROLES, STAFF_PERMISSIONS, hasDashboardPermission, isAdminRole } from "@/lib/authorization";

export const ACTIVITY_RESERVATION_KINDS = Object.freeze({
  WORKSHOP: "WORKSHOP",
  FORMATION: "FORMATION",
});

const CONFIG_BY_KIND = {
  [ACTIVITY_RESERVATION_KINDS.WORKSHOP]: {
    delegate: (client) => client.workshopReservation,
    reservationPermission: STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS,
  },
  [ACTIVITY_RESERVATION_KINDS.FORMATION]: {
    delegate: (client) => client.formationReservation,
    reservationPermission: STAFF_PERMISSIONS.FORMATION_RESERVATIONS,
  },
};

/**
 * Scope a staff member to bookings they are responsible for. Being the main
 * animator (or the creator) covers every session; being assigned to a
 * specific session covers that session only. This prevents an animator from
 * closing or marking absent a colleague's separate session of the same item.
 */
export function activityReservationStaffScope(kind, user) {
  const config = CONFIG_BY_KIND[kind];
  if (!config || !user?.id) return { id: "__never__" };

  const parentKey = kind === ACTIVITY_RESERVATION_KINDS.WORKSHOP ? "workshop" : "formation";
  const parentOwnership = [
    { createdById: user.id },
    ...(user.email ? [{ animator: { email: user.email } }] : []),
  ];

  return {
    session: {
      OR: [
        { [parentKey]: { OR: parentOwnership } },
        ...(user.email ? [{ animator: { email: user.email } }] : []),
      ],
    },
  };
}

export async function getActivityReservationCapabilities(user) {
  if (isAdminRole(user?.role)) return { canSettle: true, canMarkNoShow: true };
  if (user?.role !== ROLES.STAFF) return { canSettle: false, canMarkNoShow: false };

  const [canSettle, canMarkNoShow] = await Promise.all([
    hasDashboardPermission(user, STAFF_PERMISSIONS.ACTIVITY_SETTLEMENTS),
    hasDashboardPermission(user, STAFF_PERMISSIONS.ACTIVITY_ATTENDANCE),
  ]);
  return { canSettle, canMarkNoShow };
}

/** Server-side guard for every mutable activity reservation operation. */
export async function authorizeActivityReservationOperation({ kind, reservationId, user, capability }) {
  const config = CONFIG_BY_KIND[kind];
  if (!config || !reservationId) return { success: false, message: "Réservation introuvable." };
  if (!user) return { success: false, message: "Non authentifié." };
  if (isAdminRole(user.role)) return { success: true };
  if (user.role !== ROLES.STAFF) return { success: false, message: "Non autorisé." };

  const [canViewReservations, hasCapability] = await Promise.all([
    hasDashboardPermission(user, config.reservationPermission),
    hasDashboardPermission(user, capability),
  ]);
  if (!canViewReservations || !hasCapability) return { success: false, message: "Non autorisé." };

  const reservation = await config.delegate(prisma).findFirst({
    where: { id: reservationId, ...activityReservationStaffScope(kind, user) },
    select: { id: true },
  });
  return reservation
    ? { success: true }
    : { success: false, message: "Cette réservation ne fait pas partie de vos séances." };
}
