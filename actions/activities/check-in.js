"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  ROLES,
  getStaffId,
  hasDashboardPermission,
  STAFF_PERMISSIONS,
} from "@/lib/authorization";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";
import { CHECK_IN_KINDS, checkInDelegate, ensureCheckInCode, parseCheckInCode } from "@/lib/activities/check-in-code";

/**
 * Counter scanning for rendez-vous, ateliers, événements et formations.
 *
 * The QR is a bearer token — a photo of a valid one scans identically — so
 * what these actions actually provide is a *server-side* answer instead of a
 * forwarded confirmation e-mail. Everything staff needs before deciding to
 * check someone in (holder name, seats already admitted, balance still owed)
 * is returned by the lookup and shown before anything is written.
 *
 * Check-in and settling the balance are deliberately independent actions:
 * completeAppointment/completeWorkshopReservation/completeFormationReservation
 * mark the prestation COMPLETED, which would be wrong to do the moment
 * someone merely walks in. See actions/boutique/settlements.js for the
 * balance side; this file only ever writes checkedInAt/checkedInSeats.
 */

const PERMISSION_BY_KIND = {
  [CHECK_IN_KINDS.WORKSHOP]: STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS,
  [CHECK_IN_KINDS.FORMATION]: STAFF_PERMISSIONS.FORMATION_RESERVATIONS,
  [CHECK_IN_KINDS.APPOINTMENT]: STAFF_PERMISSIONS.APPOINTMENTS,
};

const KIND_LABEL = {
  [CHECK_IN_KINDS.WORKSHOP]: "atelier / événement",
  [CHECK_IN_KINDS.FORMATION]: "formation",
  [CHECK_IN_KINDS.APPOINTMENT]: "rendez-vous",
};

/**
 * Resolves the scanned code and checks the caller may open *that* door.
 * A staff member holding only FORMATION_RESERVATIONS who scans an atelier
 * ticket is told the code belongs to another section rather than
 * "introuvable" — the code's existence is not a secret, its holder is.
 */
async function authorizeScan(rawCode) {
  const session = await auth();
  if (!session?.user) return { error: "Vous devez être connecté(e)." };

  const parsed = parseCheckInCode(rawCode);
  if (!parsed || !PERMISSION_BY_KIND[parsed.kind]) {
    return {
      error:
        "Code non reconnu. Attendu : R-XXXXXXXXXX (rendez-vous), A-XXXXXXXXXX (atelier), F-XXXXXXXXXX (formation).",
    };
  }

  if (!(await hasDashboardPermission(session.user, PERMISSION_BY_KIND[parsed.kind]))) {
    return { error: `Ce code concerne un ${KIND_LABEL[parsed.kind]} — vous n'avez pas cette permission.` };
  }

  let ownStaffId = null;
  if (parsed.kind === CHECK_IN_KINDS.APPOINTMENT && session.user.role === ROLES.STAFF) {
    ownStaffId = await getStaffId(session);
    if (!ownStaffId) return { error: "Profil staff introuvable." };
  }

  return { session, ownStaffId, ...parsed };
}

function isOutsideAppointmentScope(guard, reservation) {
  return guard.kind === CHECK_IN_KINDS.APPOINTMENT
    && guard.ownStaffId
    && reservation.staffId !== guard.ownStaffId;
}

const RESERVATION_INCLUDE = {
  [CHECK_IN_KINDS.WORKSHOP]: {
    customer: { select: { fullName: true, email: true } },
    session: {
      select: { startDate: true, endDate: true, workshop: { select: { title: true, type: true } } },
    },
  },
  [CHECK_IN_KINDS.FORMATION]: {
    customer: { select: { fullName: true, email: true } },
    session: {
      select: { startDate: true, endDate: true, formation: { select: { title: true, type: true } } },
    },
  },
  [CHECK_IN_KINDS.APPOINTMENT]: {
    user: { select: { fullName: true, email: true } },
    staffService: {
      select: {
        service: { select: { name: true } },
        staff: { select: { user: { select: { fullName: true } } } },
      },
    },
    payment: { select: { totalAmount: true, paidAmount: true, remainingAmount: true } },
  },
};

/**
 * An appointment is always one person — there is no seats counter on the
 * table, so check-in is a single timestamp rather than an admitted-count.
 * Its balance lives on Payment rather than on the reservation row itself.
 */
function presentAppointment(appointment) {
  const alreadyIn = Boolean(appointment.checkedInAt);

  // Ordered the same way as the reservation cases below: an unpaid or
  // cancelled booking first, an exhausted ticket second.
  let blockedReason = null;
  if (appointment.status === "PENDING" || appointment.status === "ACCEPTED") {
    blockedReason = "Rendez-vous non confirmé — aucun paiement encaissé.";
  } else if (appointment.status === "CANCELLED" || appointment.status === "REJECTED") {
    blockedReason = "Rendez-vous annulé.";
  } else if (appointment.status === "NO_SHOW") {
    blockedReason = "Client marqué absent sur ce rendez-vous.";
  } else if (appointment.status !== "CONFIRMED") {
    blockedReason = "Ce rendez-vous est clôturé.";
  } else if (alreadyIn) {
    blockedReason = "Ce rendez-vous a déjà été pointé.";
  }

  return {
    kind: CHECK_IN_KINDS.APPOINTMENT,
    reservationId: appointment.id,
    code: appointment.checkInCode,
    activityTitle: appointment.staffService.service.name,
    activityType: "APPOINTMENT",
    staffName: appointment.staffService.staff?.user?.fullName ?? null,
    sessionStartDate: appointment.startTime,
    sessionEndDate: appointment.endTime,
    holderName: appointment.user.fullName,
    holderEmail: appointment.user.email,
    status: appointment.status,
    seatsCount: 1,
    checkedInSeats: alreadyIn ? 1 : 0,
    remainingSeats: alreadyIn ? 0 : 1,
    balanceDue: Number(appointment.payment?.remainingAmount ?? 0),
    totalPrice: Number(appointment.payment?.totalAmount ?? 0),
    admissible: blockedReason === null,
    blockedReason,
  };
}

function presentReservation(reservation, kind) {
  if (kind === CHECK_IN_KINDS.APPOINTMENT) return presentAppointment(reservation);

  const activity =
    kind === CHECK_IN_KINDS.WORKSHOP ? reservation.session.workshop : reservation.session.formation;
  const remainingSeats = reservation.seatsCount - reservation.checkedInSeats;

  // Ordered by how badly each case should stop the door: an unpaid or
  // cancelled booking first, an exhausted ticket second.
  let blockedReason = null;
  if (reservation.status === "PENDING_DEPOSIT") {
    blockedReason = "Réservation non payée — aucun acompte encaissé.";
  } else if (reservation.status === "CANCELLED") {
    blockedReason = "Réservation annulée.";
  } else if (reservation.status !== "CONFIRMED") {
    blockedReason = "Cette réservation est clôturée.";
  } else if (remainingSeats <= 0) {
    blockedReason = "Toutes les places de ce billet ont déjà été pointées.";
  }

  return {
    kind,
    reservationId: reservation.id,
    code: reservation.checkInCode,
    activityTitle: activity.title,
    activityType: activity.type,
    sessionStartDate: reservation.session.startDate,
    sessionEndDate: reservation.session.endDate,
    holderName: reservation.customer.fullName,
    holderEmail: reservation.customer.email,
    status: reservation.status,
    seatsCount: reservation.seatsCount,
    checkedInSeats: reservation.checkedInSeats,
    remainingSeats: Math.max(remainingSeats, 0),
    // The single most important number on this screen: ateliers et
    // formations are sold on a 50% acompte, so a perfectly valid ticket can
    // still owe half the price at the door.
    balanceDue: Number(reservation.balanceDue),
    totalPrice: Number(reservation.totalPrice),
    admissible: blockedReason === null,
    blockedReason,
  };
}

/** Read-only: what staff sees before deciding to check anyone in. */
export async function lookupActivityCheckIn(rawCode) {
  const guard = await authorizeScan(rawCode);
  if (guard.error) return { success: false, message: guard.error };

  try {
    const reservation = await checkInDelegate(prisma, guard.kind).findUnique({
      where: { checkInCode: guard.code },
      include: RESERVATION_INCLUDE[guard.kind],
    });
    if (!reservation || isOutsideAppointmentScope(guard, reservation)) {
      return { success: false, message: "Billet introuvable — vérifiez le code." };
    }

    return { success: true, data: presentReservation(reservation, guard.kind) };
  } catch (error) {
    console.error("[lookupActivityCheckIn]", error);
    return { success: false, message: "Impossible de lire ce billet." };
  }
}

/**
 * Same lookup, entered from the name-search fallback (actions/boutique/
 * settlements.js) instead of a scanned code — a customer with no phone, a
 * dead battery, or who never received the confirmation e-mail still has a
 * row in that search once their booking is CONFIRMED. Mints a code on first
 * use exactly like the customer's own profile page does, so this reservation
 * behaves identically whether it's opened by scan or by name from now on.
 */
export async function lookupActivityCheckInById({ kind, id }) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Vous devez être connecté(e)." };
  if (!PERMISSION_BY_KIND[kind]) return { success: false, message: "Type de document inconnu." };
  if (!(await hasDashboardPermission(session.user, PERMISSION_BY_KIND[kind]))) {
    return { success: false, message: `Ce document concerne un ${KIND_LABEL[kind]} — vous n'avez pas cette permission.` };
  }

  try {
    let reservation = await checkInDelegate(prisma, kind).findUnique({
      where: { id },
      include: RESERVATION_INCLUDE[kind],
    });
    if (!reservation) return { success: false, message: "Introuvable." };

    if (kind === CHECK_IN_KINDS.APPOINTMENT && session.user.role === ROLES.STAFF) {
      const ownStaffId = await getStaffId(session);
      if (!ownStaffId || reservation.staffId !== ownStaffId) {
        return { success: false, message: "Introuvable." };
      }
    }

    if (reservation.status === "CONFIRMED" && !reservation.checkInCode) {
      await ensureCheckInCode(prisma, kind, id);
      reservation = await checkInDelegate(prisma, kind).findUnique({
        where: { id },
        include: RESERVATION_INCLUDE[kind],
      });
      if (!reservation) return { success: false, message: "Introuvable." };
    }

    return { success: true, data: presentReservation(reservation, kind) };
  } catch (error) {
    console.error("[lookupActivityCheckInById]", error);
    return { success: false, message: "Impossible de lire ce dossier." };
  }
}

const TABLE_BY_KIND = {
  [CHECK_IN_KINDS.WORKSHOP]: "workshop_reservations",
  [CHECK_IN_KINDS.FORMATION]: "formation_reservations",
  [CHECK_IN_KINDS.APPOINTMENT]: "Appointment",
};

/**
 * Admits every remaining holder on this paid ticket (always 1 for an
 * appointment). Changing the reservation's seat count is a separate paid
 * workflow; the counter must never choose or mutate that commercial quantity.
 *
 * Row-locked rather than a conditional updateMany because the guard compares
 * two columns (checkedInSeats and seatsCount), which Prisma's `where` cannot
 * express. Same FOR UPDATE pattern the seat-capacity check already uses in
 * createWorkshopReservation.
 */
export async function confirmActivityCheckIn({ code: rawCode }) {
  const guard = await authorizeScan(rawCode);
  if (guard.error) return { success: false, message: guard.error };

  const isAppointment = guard.kind === CHECK_IN_KINDS.APPOINTMENT;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const table = TABLE_BY_KIND[guard.kind];
      const locked = await tx.$queryRawUnsafe(
        `SELECT id FROM "${table}" WHERE "checkInCode" = $1 FOR UPDATE`,
        guard.code
      );
      if (locked.length === 0) throw new Error("NOT_FOUND");

      const delegate = checkInDelegate(tx, guard.kind);
      const reservation = await delegate.findUnique({
        where: { checkInCode: guard.code },
        include: RESERVATION_INCLUDE[guard.kind],
      });
      if (!reservation || isOutsideAppointmentScope(guard, reservation)) throw new Error("NOT_FOUND");

      const before = presentReservation(reservation, guard.kind);
      if (!before.admissible) throw new Error(`BLOCKED:${before.blockedReason}`);
      const seatsAdmitted = isAppointment ? 1 : before.remainingSeats;

      const updated = await delegate.update({
        where: { id: reservation.id },
        data: isAppointment
          ? { checkedInAt: new Date(), checkedInById: guard.session.user.id }
          : {
              checkedInSeats: { increment: seatsAdmitted },
              // Keep the original arrival time if an old, partially checked-in
              // ticket is completed after this all-remaining-seats rule.
              checkedInAt: reservation.checkedInAt ?? new Date(),
              checkedInById: guard.session.user.id,
            },
        include: RESERVATION_INCLUDE[guard.kind],
      });

      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.RESERVATION_CHECKED_IN,
        entityType: table,
        entityId: reservation.id,
        before: isAppointment
          ? { checkedInAt: reservation.checkedInAt }
          : { checkedInSeats: reservation.checkedInSeats },
        after: isAppointment
          ? { checkedInAt: updated.checkedInAt }
          : { checkedInSeats: updated.checkedInSeats },
        metadata: {
          kind: guard.kind,
          seatsAdmitted,
          balanceDueAtEntry: before.balanceDue,
        },
        actor: guard.session.user,
      });

      return {
        data: presentReservation(updated, guard.kind),
        seatsAdmitted,
      };
    });

    return { success: true, data: result.data, seatsAdmitted: result.seatsAdmitted };
  } catch (error) {
    if (error?.message === "NOT_FOUND") {
      return { success: false, message: "Billet introuvable — vérifiez le code." };
    }
    if (typeof error?.message === "string" && error.message.startsWith("BLOCKED:")) {
      return { success: false, message: error.message.slice("BLOCKED:".length) };
    }
    console.error("[confirmActivityCheckIn]", error);
    return { success: false, message: "Impossible de pointer ce billet." };
  }
}
