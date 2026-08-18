"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { reservationCreatedAutomaticEmail } from "@/lib/email-templates";
import { hasPermission, DASHBOARD_PERMISSIONS, isAdminRole } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";
import { buildAppointmentWindow, findConflictingAppointment } from "@/lib/appointment-scheduling";
import {
  createNotificationsBulk,
  buildAppointmentConfirmedNotification,
  getAppointmentNotificationRecipients,
} from "@/lib/notifications";
import { resolveOrCreateCustomer } from "@/actions/reservation/create-reservation";
import { SessionExpiredError, PhoneAlreadyRegisteredError } from "@/lib/reservation-errors";

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
 * Lists a staff member's active, bookable services — for the "add manual
 * appointment" form's service picker.
 *
 * @param {string} staffId
 */
export async function getStaffServicesForManualBooking(staffId) {
  try {
    const session = await auth();
    if (!session?.user || !hasPermission(session.user.role, DASHBOARD_PERMISSIONS.APPOINTMENTS)) {
      return { success: false, message: "Non autorisé.", data: [] };
    }
    if (!staffId) return { success: true, data: [] };

    const staffServices = await prisma.staffService.findMany({
      where: {
        staffId,
        isActive: true,
      },
      select: {
        id: true,
        price: true,
        duration: true,
        service: { select: { id: true, name: true } },
      },
      orderBy: { service: { name: "asc" } },
    });

    return {
      success: true,
      data: staffServices.map((s) => ({
        id: s.id,
        price: Number(s.price),
        duration: s.duration,
        serviceName: s.service.name,
      })),
    };
  } catch (error) {
    console.error("[getStaffServicesForManualBooking]", error);
    return { success: false, message: "Impossible de charger les prestations.", data: [] };
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
    if (!session?.user || !hasPermission(session.user.role, DASHBOARD_PERMISSIONS.APPOINTMENTS)) {
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
  notes: z.string().trim().max(1000).optional().nullable(),
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
 * Unlike createReservation (the public flow), this never enforces working
 * hours / closures / time-off: staff creating this themselves is inherently
 * an override of the published schedule (that's the whole point of "fit
 * this client in"). It still refuses a genuine double-booking and a past
 * time slot — those are correctness guarantees, not availability policy.
 *
 * Always creates the appointment as CONFIRMED with no Payment row, same
 * shape as a CASH_ONLY public booking — payment is recorded later, the same
 * way it already is for any on-site appointment, via completeAppointment()
 * once the visit actually happens.
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
    if (!session?.user || !hasPermission(session.user.role, DASHBOARD_PERMISSIONS.APPOINTMENTS)) {
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
        staff: { select: { id: true, user: { select: { fullName: true } } } },
      },
    });

    if (!staffService || staffService.staffId !== staffId || !staffService.isActive) {
      return { success: false, message: "Prestation introuvable pour ce membre du personnel." };
    }

    const { appointmentDate, startTime, endTime } = buildAppointmentWindow(date, time, staffService.duration);

    if (startTime.getTime() < Date.now()) {
      return { success: false, message: "Ce créneau est déjà passé. Veuillez choisir un horaire à venir." };
    }

    const conflict = await findConflictingAppointment(staffServiceId, appointmentDate, startTime, endTime);
    if (conflict) {
      return { success: false, message: "Ce créneau est déjà occupé par un autre rendez-vous." };
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
        status: "CONFIRMED",
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

    sendEmail({
      to: user.email,
      ...reservationCreatedAutomaticEmail({
        customerName: user.fullName,
        serviceName,
        staffName,
        date: appointmentDate,
        time,
        totalAmount: Number(staffService.price),
      }),
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
