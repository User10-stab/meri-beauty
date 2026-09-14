"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import {
  updateReservationSettingsSchema,
  staffTimeOffSchema,
} from "@/lib/validations/staff-settings";

const REVALIDATE_PATH = "/dashboard/staff/auto-entrepreneur";
const VALID_PAYMENT_METHODS = ["BOTH", "ONLINE_ONLY", "CASH_ONLY"];

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return null;
  }
  return session;
}

async function resolveStaff(staffId) {
  if (!staffId) return null;
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: { id: true, type: true, isDeleted: true },
  });
  if (!staff || staff.isDeleted) return null;
  return staff;
}

function buildDateTime(dateStr, timeStr, isEnd = false) {
  if (timeStr) {
    return new Date(`${dateStr}T${timeStr}:00`);
  }
  return isEnd
    ? new Date(`${dateStr}T23:59:59`)
    : new Date(`${dateStr}T00:00:00`);
}

function generateToken() {
  return randomBytes(24).toString("hex");
}

/**
 * Admin-scoped read of a single staff member's booking/payment settings.
 * Mirrors getStaffSettings() but targets an explicit staffId instead of the
 * session user, so the dashboard staff table can open per-staff "Paramètres".
 */
export async function getStaffSettingsForAdmin(staffId) {
  const session = await requireAdmin();
  if (!session) {
    return { success: false, message: "Permissions insuffisantes", data: null };
  }

  try {
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, phone: true },
        },
        timeOffs: { orderBy: { startDate: "asc" } },
      },
    });

    if (!staff || staff.isDeleted) {
      return { success: false, message: "Profil staff introuvable.", data: null };
    }

    return {
      success: true,
      data: {
        id: staff.id,
        user: staff.user,
        reservationConfirmationMode: staff.reservationConfirmationMode,
        depositEnabled: Boolean(staff.depositEnabled),
        depositPercentage: Number(staff.depositPercentage ?? 0),
        allowedPaymentMethods: staff.allowedPaymentMethods ?? "BOTH",
        timeOffs: staff.timeOffs.map((item) => ({
          id: item.id,
          startDate: item.startDate.toISOString(),
          endDate: item.endDate.toISOString(),
          isFullDay: item.isFullDay,
          reason: item.reason,
        })),
      },
    };
  } catch (error) {
    console.error("[getStaffSettingsForAdmin]", error);
    return { success: false, message: "Impossible de charger les paramètres.", data: null };
  }
}

/**
 * Admin-scoped payment settings update for one staff member.
 * Same business rule as the self-service action: CASH_ONLY force-disables deposits.
 */
export async function updateStaffPaymentSettingsForAdmin(staffId, { allowedPaymentMethods }) {
  const session = await requireAdmin();
  if (!session) {
    return { success: false, message: "Permissions insuffisantes" };
  }
  if (!VALID_PAYMENT_METHODS.includes(allowedPaymentMethods)) {
    return { success: false, message: "Valeur invalide pour les méthodes de paiement." };
  }

  try {
    const staff = await resolveStaff(staffId);
    if (!staff) {
      return { success: false, message: "Profil staff introuvable." };
    }

    await prisma.staff.update({
      where: { id: staff.id },
      data: {
        allowedPaymentMethods,
        ...(allowedPaymentMethods === "CASH_ONLY"
          ? { depositEnabled: false, depositPercentage: 0 }
          : {}),
      },
    });

    revalidatePath(REVALIDATE_PATH);
    return { success: true, message: "Paramètres de paiement mis à jour." };
  } catch (error) {
    console.error("[updateStaffPaymentSettingsForAdmin]", error);
    return { success: false, message: "Erreur lors de la mise à jour." };
  }
}

/**
 * Admin-scoped reservation settings update for one staff member.
 * Same validation + payment-method dependency as the self-service action.
 */
export async function updateStaffReservationSettingsForAdmin(staffId, input) {
  const session = await requireAdmin();
  if (!session) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  const parsed = updateReservationSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs.",
      errors: {
        confirmationMode: fe.confirmationMode?.[0] ?? null,
        depositEnabled: fe.depositEnabled?.[0] ?? null,
        depositPercentage: fe.depositPercentage?.[0] ?? null,
      },
    };
  }

  try {
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, isDeleted: true, allowedPaymentMethods: true },
    });
    if (!staff || staff.isDeleted) {
      return { success: false, message: "Profil staff introuvable." };
    }

    const { confirmationMode, depositEnabled, depositPercentage } = parsed.data;

    const acceptsOnline =
      staff.allowedPaymentMethods === "BOTH" ||
      staff.allowedPaymentMethods === "ONLINE_ONLY";

    if (depositEnabled && !acceptsOnline) {
      return {
        success: false,
        message: "Le paiement en ligne doit être activé pour pouvoir demander un acompte.",
        errors: {
          confirmationMode: null,
          depositEnabled: "Acompte indisponible sans paiement en ligne.",
          depositPercentage: null,
        },
      };
    }

    await prisma.staff.update({
      where: { id: staff.id },
      data: {
        reservationConfirmationMode: confirmationMode,
        depositEnabled: acceptsOnline ? depositEnabled : false,
        depositPercentage:
          acceptsOnline && depositEnabled && depositPercentage != null
            ? depositPercentage
            : 0,
      },
    });

    revalidatePath(REVALIDATE_PATH);
    return { success: true, message: "Paramètres de réservation mis à jour." };
  } catch (error) {
    console.error("[updateStaffReservationSettingsForAdmin]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}

/** Admin-scoped time-off creation for one staff member. */
export async function createStaffTimeOffForAdmin(staffId, input) {
  const session = await requireAdmin();
  if (!session) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  const parsed = staffTimeOffSchema.safeParse(input);
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs dans les indisponibilités.",
      errors: {
        startDate: fe.startDate?.[0] ?? null,
        endDate: fe.endDate?.[0] ?? null,
        startTime: fe.startTime?.[0] ?? null,
        endTime: fe.endTime?.[0] ?? null,
        isFullDay: fe.isFullDay?.[0] ?? null,
        reason: fe.reason?.[0] ?? null,
      },
    };
  }

  try {
    const staff = await resolveStaff(staffId);
    if (!staff) {
      return { success: false, message: "Profil staff introuvable." };
    }

    const { startDate, endDate, isFullDay, startTime, endTime, reason } = parsed.data;

    const created = await prisma.timeOff.create({
      data: {
        staffId: staff.id,
        startDate: buildDateTime(startDate.split("T")[0], isFullDay ? null : startTime, false),
        endDate: buildDateTime(endDate.split("T")[0], isFullDay ? null : endTime, true),
        isFullDay,
        reason: reason || null,
      },
      select: { id: true, startDate: true, endDate: true, isFullDay: true, reason: true },
    });

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: "Période d'indisponibilité ajoutée.",
      data: {
        id: created.id,
        startDate: created.startDate.toISOString(),
        endDate: created.endDate.toISOString(),
        isFullDay: created.isFullDay,
        reason: created.reason,
      },
    };
  } catch (error) {
    console.error("[createStaffTimeOffForAdmin]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}

/** Admin-scoped time-off update (scoped to the given staffId). */
export async function updateStaffTimeOffForAdmin(timeOffId, staffId, input) {
  const session = await requireAdmin();
  if (!session) {
    return { success: false, message: "Permissions insuffisantes" };
  }
  if (!timeOffId) {
    return { success: false, message: "Indisponibilité introuvable." };
  }

  const parsed = staffTimeOffSchema.safeParse(input);
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs dans les indisponibilités.",
      errors: {
        startDate: fe.startDate?.[0] ?? null,
        endDate: fe.endDate?.[0] ?? null,
        startTime: fe.startTime?.[0] ?? null,
        endTime: fe.endTime?.[0] ?? null,
        isFullDay: fe.isFullDay?.[0] ?? null,
        reason: fe.reason?.[0] ?? null,
      },
    };
  }

  try {
    const staff = await resolveStaff(staffId);
    if (!staff) {
      return { success: false, message: "Profil staff introuvable." };
    }

    const { startDate, endDate, isFullDay, startTime, endTime, reason } = parsed.data;

    const { count } = await prisma.timeOff.updateMany({
      where: { id: timeOffId, staffId: staff.id },
      data: {
        startDate: buildDateTime(startDate.split("T")[0], isFullDay ? null : startTime, false),
        endDate: buildDateTime(endDate.split("T")[0], isFullDay ? null : endTime, true),
        isFullDay,
        reason: reason || null,
      },
    });

    if (count === 0) {
      return { success: false, message: "Indisponibilité introuvable." };
    }

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: "Période d'indisponibilité modifiée.",
      data: {
        id: timeOffId,
        startDate: buildDateTime(startDate.split("T")[0], isFullDay ? null : startTime, false).toISOString(),
        endDate: buildDateTime(endDate.split("T")[0], isFullDay ? null : endTime, true).toISOString(),
        isFullDay,
        reason: reason || null,
      },
    };
  } catch (error) {
    console.error("[updateStaffTimeOffForAdmin]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}

/** Admin-scoped time-off deletion (scoped to the given staffId). */
export async function deleteStaffTimeOffForAdmin(timeOffId, staffId) {
  const session = await requireAdmin();
  if (!session) {
    return { success: false, message: "Permissions insuffisantes" };
  }
  if (!timeOffId) {
    return { success: false, message: "Indisponibilité introuvable." };
  }

  try {
    const staff = await resolveStaff(staffId);
    if (!staff) {
      return { success: false, message: "Profil staff introuvable." };
    }

    const { count } = await prisma.timeOff.deleteMany({
      where: { id: timeOffId, staffId: staff.id },
    });

    if (count === 0) {
      return { success: false, message: "Indisponibilité introuvable." };
    }

    revalidatePath(REVALIDATE_PATH);
    return { success: true, message: "Indisponibilité supprimée." };
  } catch (error) {
    console.error("[deleteStaffTimeOffForAdmin]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}

/** Admin-scoped calendar feed token read (idempotent). */
export async function getOrCreateCalendarTokenForAdmin(staffId) {
  const session = await requireAdmin();
  if (!session) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  try {
    const staff = await resolveStaff(staffId);
    if (!staff) {
      return { success: false, message: "Profil staff introuvable." };
    }

    const row = await prisma.staff.findUnique({
      where: { id: staff.id },
      select: { calendarToken: true },
    });
    if (row?.calendarToken) {
      return { success: true, token: row.calendarToken };
    }

    const token = generateToken();
    await prisma.staff.update({ where: { id: staff.id }, data: { calendarToken: token } });
    return { success: true, token };
  } catch (error) {
    console.error("[getOrCreateCalendarTokenForAdmin]", error);
    return { success: false, message: "Impossible de générer le lien du calendrier." };
  }
}

/** Admin-scoped calendar feed token rotation. */
export async function regenerateCalendarTokenForAdmin(staffId) {
  const session = await requireAdmin();
  if (!session) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  try {
    const staff = await resolveStaff(staffId);
    if (!staff) {
      return { success: false, message: "Profil staff introuvable." };
    }

    const token = generateToken();
    await prisma.staff.update({ where: { id: staff.id }, data: { calendarToken: token } });
    revalidatePath(REVALIDATE_PATH);
    return { success: true, token };
  } catch (error) {
    console.error("[regenerateCalendarTokenForAdmin]", error);
    return { success: false, message: "Impossible de régénérer le lien du calendrier." };
  }
}
