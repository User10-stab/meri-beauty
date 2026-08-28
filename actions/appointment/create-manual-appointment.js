"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { reservationCreatedAutomaticEmail } from "@/lib/email-templates";
import { buildAppointmentCheckInEmailAssets } from "@/lib/activities/appointment-check-in-qr";
import { hasDashboardPermission, STAFF_PERMISSIONS, isAdminRole } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";
import {
  buildAppointmentWindow,
  findConflictingAppointment,
  validateAppointmentSlot,
} from "@/lib/appointment-scheduling";
import {
  createNotificationsBulk,
  buildAppointmentConfirmedNotification,
  getAppointmentNotificationRecipients,
} from "@/lib/notifications";
import { resolveOrCreateCustomer } from "@/actions/reservation/create-reservation";
import { SessionExpiredError, PhoneAlreadyRegisteredError } from "@/lib/reservation-errors";
import { getReservationPaymentDecision } from "@/lib/reservation-payment";
import { getAvailableSlots as getAvailableSlotsAction } from "@/actions/reservation/get-available-slots";

// Re-export getAvailableSlots for use in the manual appointment modal
export const getAvailableSlots = getAvailableSlotsAction;

/**
 * Resolves which staff member the caller may act on behalf of.
 * STAFF may only add to their own calendar; ADMIN/OWNER may pick any staff.
 */
async function resolveActingStaffId(session, requestedStaffId) {
  if (isAdminRole(session.user.role)) {
    return requestedStaffId || null;
  }
  const ownStaffId = await getCurrentStaffId();
  if (!ownStaffId) return null;
  if (requestedStaffId && requestedStaffId !== ownStaffId) return null;
  return ownStaffId;
}

/**
 * Lists every service that can be booked manually — i.e. that has at least
 * one active, priced staff assignment. For STAFF callers, restricted to the
 * services the caller themselves provides.
 *
 * @returns {Promise<{ success: boolean, data: Array<{ id, name, categoryName }>, message?: string }>}
 */
export async function getServicesForManualBooking() {
  try {
    const session = await auth();
    if (!session?.user || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS))) {
      return { success: false, message: "Non autorisé.", data: [] };
    }

    const callerStaffId = isAdminRole(session.user.role) ? null : await getCurrentStaffId();

    const services = await prisma.service.findMany({
      where: {
        staffServices: {
          some: {
            isActive: true,
            price: { gt: 0 },
            duration: { gt: 0 },
            ...(callerStaffId ? { staffId: callerStaffId } : {}),
          },
        },
      },
      select: {
        id: true,
        name: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    });

    return {
      success: true,
      data: services.map((s) => ({
        id: s.id,
        name: s.name,
        categoryName: s.category?.name ?? null,
      })),
    };
  } catch (error) {
    console.error("[getServicesForManualBooking]", error);
    return { success: false, message: "Impossible de charger les prestations.", data: [] };
  }
}

/**
 * Lists the staff members who provide a given service — each with their own
 * price and duration for that service. STAFF callers only see themselves.
 *
 * @param {string} serviceId
 * @returns {Promise<{ success: boolean, data: Array<{ staffServiceId, staffId, staffName, price, duration }>, message?: string }>}
 */
export async function getStaffForManualBooking(serviceId) {
  try {
    const session = await auth();
    if (!session?.user || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS))) {
      return { success: false, message: "Non autorisé.", data: [] };
    }
    if (!serviceId) return { success: true, data: [] };

    const callerStaffId = isAdminRole(session.user.role) ? null : await getCurrentStaffId();

    const staffServices = await prisma.staffService.findMany({
      where: {
        serviceId,
        isActive: true,
        price: { gt: 0 },
        duration: { gt: 0 },
        staff: { isActive: true, isDeleted: false },
        ...(callerStaffId ? { staffId: callerStaffId } : {}),
      },
      select: {
        id: true,
        price: true,
        duration: true,
        staff: { select: { id: true, user: { select: { fullName: true } } } },
      },
      orderBy: { staff: { user: { fullName: "asc" } } },
    });

    return {
      success: true,
      data: staffServices.map((s) => ({
        staffServiceId: s.id,
        staffId: s.staff.id,
        staffName: s.staff.user?.fullName ?? "Membre du personnel",
        price: Number(s.price),
        duration: s.duration,
      })),
    };
  } catch (error) {
    console.error("[getStaffForManualBooking]", error);
    return { success: false, message: "Impossible de charger le personnel.", data: [] };
  }
}

/**
 * Searches existing customers by name, email, or phone — for the "add
 * manual appointment" form's customer picker. Returns at most 8 matches.
 *
 * @param {string} query
 */
export async function searchCustomersForManualBooking(query) {
  try {
    const session = await auth();
    if (!session?.user || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS))) {
      return { success: false, message: "Non autorisé.", data: [] };
    }
    const trimmed = (query ?? "").trim();
    if (trimmed.length < 2) return { success: true, data: [] };

    const customers = await prisma.user.findMany({
      where: {
        role: "CUSTOMER",
        isDeleted: false,
        OR: [
          { fullName: { contains: trimmed, mode: "insensitive" } },
          { email: { contains: trimmed, mode: "insensitive" } },
          { phone: { contains: trimmed } },
        ],
      },
      select: { id: true, fullName: true, email: true, phone: true },
      take: 8,
      orderBy: { fullName: "asc" },
    });

    return { success: true, data: customers };
  } catch (error) {
    console.error("[searchCustomersForManualBooking]", error);
    return { success: false, message: "Recherche impossible.", data: [] };
  }
}

const manualAppointmentSchema = z.object({
  staffId: z.string().min(1, "Le membre du personnel est obligatoire."),
  staffServiceId: z.string().min(1, "La prestation est obligatoire."),
  date: z.string().min(1, "La date est obligatoire."),
  time: z.string().min(1, "L'heure est obligatoire."),
  notes: z.string().trim().optional().nullable(),
  customer: z.union([
    z.object({ userId: z.string().min(1) }),
    z.object({
      fullName: z.string().trim().min(2, "Le nom du client est obligatoire."),
      email: z.string().trim().email("Adresse e-mail invalide."),
      phone: z.string().trim().min(6, "Le numéro de téléphone est obligatoire."),
    }),
  ]),
});

/**
 * Lets staff/admin add an appointment directly from the dashboard calendar —
 * a phone booking or walk-in that never went through the public site.
 *
 * Unlike the old manual-booking behaviour, this enforces the exact same
 * availability rules as the public online flow (working hours, closures,
 * time-off, contract dates, double-booking) — the UI only offers slots that
 * pass those rules, and this action re-validates them server-side so a slot
 * can't slip through if it was taken in the meantime.
 *
 * Always creates the appointment as CONFIRMED (manual reservations are always
 * confirmed regardless of staff's reservationConfirmationMode). Payment rules
 * respect the staff's configuration (deposit, online payment, cash payment).
 *
 * @param {{
 *   staffId: string,
 *   staffServiceId: string,
 *   date: string,
 *   time: string,
 *   notes?: string,
 *   customer: { userId: string } | { fullName: string, email: string, phone: string },
 * }} input
 */
export async function createManualAppointment(input) {
  try {
    const session = await auth();
    if (!session?.user || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS))) {
      return { success: false, message: "Non autorisé." };
    }

    const parsed = manualAppointmentSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors = {};
      parsed.error.issues.forEach((err) => {
        fieldErrors[err.path[0]] = err.message;
      });
      return { success: false, message: "Veuillez corriger les erreurs du formulaire.", errors: fieldErrors };
    }

    const { staffServiceId, date, time, notes, customer } = parsed.data;

    const staffId = await resolveActingStaffId(session, parsed.data.staffId);
    if (!staffId) {
      return { success: false, message: "Vous ne pouvez ajouter un rendez-vous que sur votre propre agenda." };
    }

    const staffService = await prisma.staffService.findUnique({
      where: { id: staffServiceId },
      include: {
        service: { select: { id: true, name: true } },
        staff: {
          select: {
            id: true,
            user: { select: { fullName: true } },
            reservationConfirmationMode: true,
            depositEnabled: true,
            depositPercentage: true,
            allowedPaymentMethods: true,
          },
        },
      },
    });

    if (!staffService || staffService.staffId !== staffId || !staffService.isActive) {
      return { success: false, message: "Prestation introuvable pour ce membre du personnel." };
    }

    // ── Resolve payment decision for manual reservation ─────────────────────
    // Manual reservations are always CONFIRMED but payment rules still apply
    const paymentDecision = getReservationPaymentDecision({
      appointmentCount: 1,
      confirmationMode: staffService.staff?.reservationConfirmationMode ?? "MANUAL",
      depositEnabled: Boolean(staffService.staff?.depositEnabled),
      depositPercentage: Number(staffService.staff?.depositPercentage ?? 0),
      allowedPaymentMethods: staffService.staff?.allowedPaymentMethods ?? "BOTH",
      totalAmount: Number(staffService.price),
      isManualReservation: true,
    });

    const { appointmentDate, startTime, endTime } = buildAppointmentWindow(date, time, staffService.duration);

    if (startTime.getTime() < Date.now()) {
      return { success: false, message: "Ce créneau est déjà passé. Veuillez choisir un horaire à venir." };
    }

    // findConflictingAppointment only rules out collision with another
    // appointment — it says nothing about closures, staff time off, working
    // hours, or contract dates. Re-validate against the same rules the manual
    // booking form itself uses to offer slots, so the final check is identical
    // to the online flow and a slot taken in the meantime can't slip through.
    const conflict = await findConflictingAppointment(staffServiceId, appointmentDate, startTime, endTime);
    if (conflict) {
      return { success: false, message: "Ce créneau vient d'être réservé. Veuillez sélectionner un autre horaire." };
    }

    const slotCheck = await validateAppointmentSlot(staffServiceId, appointmentDate, startTime, time);
    if (!slotCheck.valid) {
      return { success: false, message: slotCheck.message };
    }

    // ── Resolve the customer ─────────────────────────────────────────────
    let user;
    if ("userId" in customer) {
      user = await prisma.user.findUnique({
        where: { id: customer.userId, isDeleted: false, role: "CUSTOMER" },
      });
      if (!user) {
        return { success: false, message: "Client introuvable." };
      }
    } else {
      try {
        ({ user } = await resolveOrCreateCustomer(
          { ...customer, newsletterSubscribed: false },
          undefined
        ));
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          return { success: false, message: "Session expirée, veuillez réessayer." };
        }
        if (err instanceof PhoneAlreadyRegisteredError) {
          return {
            success: false,
            field: "phone",
            message: "Ce numéro de téléphone est déjà associé à un autre compte.",
          };
        }
        throw err;
      }
    }

    const appointment = await prisma.appointment.create({
      data: {
        userId: user.id,
        staffServiceId,
        staffId,
        date: appointmentDate,
        startTime,
        endTime,
        status: paymentDecision.appointmentStatusBeforePayment,
        notes: notes || null,
      },
    });

    // ── Notifications / email (fire-and-forget, never blocks the response) ──
    const staffName = staffService.staff?.user?.fullName ?? "votre experte";
    const serviceName = staffService.service?.name ?? "votre service";

    const recipientUserIds = await getAppointmentNotificationRecipients(staffId);
    if (recipientUserIds.length > 0) {
      const inputs = recipientUserIds.map((uid) =>
        buildAppointmentConfirmedNotification({
          userId: uid,
          appointmentId: appointment.id,
          date: appointmentDate,
          startTime,
          serviceName,
          staffName,
          customerName: user.fullName,
        })
      );
      createNotificationsBulk(inputs).catch((err) =>
        console.error("[createManualAppointment] notifications failed:", err)
      );
    }

    const ticket = await buildAppointmentCheckInEmailAssets(appointment.id);
    sendEmail({
      to: user.email,
      ...reservationCreatedAutomaticEmail({
        customerName: user.fullName,
        serviceName,
        staffName,
        date: appointmentDate,
        time,
        totalAmount: Number(staffService.price),
        checkInCode: ticket.checkInCode,
      }),
      ...(ticket.attachment ? { attachments: [ticket.attachment] } : {}),
    }).catch((err) => console.error("[createManualAppointment] confirmation email failed:", err));

    return {
      success: true,
      message: "Rendez-vous ajouté avec succès.",
      data: { appointmentId: appointment.id },
    };
  } catch (error) {
    console.error("[createManualAppointment]", error);
    return { success: false, message: "Une erreur est survenue lors de la création du rendez-vous." };
  }
}
