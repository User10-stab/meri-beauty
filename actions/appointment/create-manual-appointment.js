"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import {
  reservationCreatedAutomaticEmail,
  staffReservationConfirmedEmail,
  staffReservationRequestedEmail,
} from "@/lib/email-templates";
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
  buildAppointmentCreatedNotification,
  buildAppointmentConfirmedNotification,
  getAppointmentNotificationRecipients,
  getAppointmentEmailRecipients,
} from "@/lib/notifications";
import { resolveOrCreateCustomer, sendWelcomeEmailIfNew } from "@/actions/reservation/create-reservation";
import { SessionExpiredError, PhoneAlreadyRegisteredError } from "@/lib/reservation-errors";
import { getReservationPaymentDecision } from "@/lib/reservation-payment";
import { getAvailableSlots as getAvailableSlotsAction } from "@/actions/reservation/get-available-slots";
import { isSellerLegalDataComplete } from "@/lib/invoicing";

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
        isDeleted: false,
        staffServices: {
          some: {
            isActive: true,
            isDeleted: false,
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
        isDeleted: false,
        price: { gt: 0 },
        duration: { gt: 0 },
        staff: { isActive: true, isDeleted: false },
        ...(callerStaffId ? { staffId: callerStaffId } : {}),
      },
      select: {
        id: true,
        price: true,
        duration: true,
        staff: {
          select: {
            id: true,
            depositEnabled: true,
            depositPercentage: true,
            allowedPaymentMethods: true,
            user: { select: { fullName: true } },
          },
        },
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
        depositEnabled: Boolean(s.staff.depositEnabled),
        depositPercentage: Number(s.staff.depositPercentage ?? 0),
        allowedPaymentMethods: s.staff.allowedPaymentMethods ?? "BOTH",
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
  staffId: z.string().trim().optional().nullable(),
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

    // ADMIN/OWNER must explicitly select a staff member; STAFF is auto-linked.
    if (isAdminRole(session.user.role) && !parsed.data.staffId) {
      return {
        success: false,
        message: "Veuillez corriger les erreurs du formulaire.",
        errors: { staffId: "Le membre du personnel est obligatoire." },
      };
    }

    const staffId = await resolveActingStaffId(session, parsed.data.staffId);
    if (!staffId) {
      return { success: false, message: "Vous ne pouvez ajouter un rendez-vous que sur votre propre agenda." };
    }

    const staffService = await prisma.staffService.findFirst({
      where: { id: staffServiceId, isDeleted: false },
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
            stripeAccountId: true,
            stripeChargesEnabled: true,
            stripePayoutsEnabled: true,
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
      let isNewUser = false;
      let temporaryPassword = null;
      try {
        ({ user, isNewUser, temporaryPassword } = await resolveOrCreateCustomer(
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

      // Send login credentials to newly created customers
      sendWelcomeEmailIfNew({ user, isNewUser, temporaryPassword }, "[createManualAppointment]")
        .catch((err) => console.error("[createManualAppointment] welcome email failed:", err));

      // Manual reservations are created by staff — email verification is unnecessary
      if (isNewUser) {
        prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } })
          .catch((err) => console.error("[createManualAppointment] emailVerified update failed:", err));
      }
    }

    // ── Branch on whether an acompte is required for this staff ─────────────
    // Reuses the same Staff.depositEnabled / depositPercentage / allowedPaymentMethods
    // logic as the public booking flow (getReservationPaymentDecision).
    const staffName = staffService.staff?.user?.fullName ?? "votre experte";
    const serviceName = staffService.service?.name ?? "votre service";
    const totalAmount = Number(staffService.price);
    const depositAmount = Number(paymentDecision.depositAmount ?? 0);

    if (paymentDecision.shouldCreatePaymentRecord && paymentDecision.requiresOnlinePaymentNow) {
      // ── Case 1: staff requires an acompte → PENDING + Payment + Stripe link ─
      const amountToPay = paymentDecision.paymentType === "ONLINE" ? totalAmount : depositAmount;

      if (!(await isSellerLegalDataComplete())) {
        return { success: false, message: "Le paiement en ligne n'est pas disponible pour le moment." };
      }
      const staffStripe = staffService.staff;
      if (!staffStripe?.stripeAccountId || !staffStripe.stripeChargesEnabled || !staffStripe.stripePayoutsEnabled) {
        return { success: false, message: "Le compte Stripe du professionnel n'est pas prêt à recevoir des paiements." };
      }

      // Create appointment PENDING + payment PENDING atomically
      const { appointment, payment } = await prisma.$transaction(async (tx) => {
        const appt = await tx.appointment.create({
          data: {
            userId: user.id,
            staffServiceId,
            staffId,
            date: appointmentDate,
            startTime,
            endTime,
            status: "PENDING",
            notes: notes || null,
          },
        });
        const pay = await tx.payment.create({
          data: {
            appointmentId: appt.id,
            depositAmount,
            totalAmount,
            paidAmount: 0,
            remainingAmount: totalAmount,
            paymentType: paymentDecision.paymentType,
            status: "PENDING",
          },
        });
        return { appointment: appt, payment: pay };
      });

      // Create Stripe Checkout Session (direct charge on staff's connected account)
      const checkoutSession = await stripe.checkout.sessions.create(
        {
          line_items: [
            {
              price_data: {
                currency: "eur",
                product_data: {
                  name: paymentDecision.paymentType === "ONLINE" ? serviceName : `Acompte - ${serviceName}`,
                  description: `${staffName} • ${appointmentDate.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} • ${time}`,
                },
                unit_amount: Math.round(amountToPay * 100),
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/mes-reservations?canceled=true`,
          customer_email: user.email,
          payment_intent_data: {
            metadata: {
              appointmentId: appointment.id,
              paymentId: payment.id,
              paymentScenario: paymentDecision.paymentIntent,
            },
          },
          metadata: {
            appointmentId: appointment.id,
            paymentId: payment.id,
            paymentScenario: paymentDecision.paymentIntent,
          },
        },
        { stripeAccount: staffService.staff.stripeAccountId }
      );

      await prisma.payment.update({
        where: { id: payment.id },
        data: { transactionReference: checkoutSession.id },
      });

      const paymentUrl = checkoutSession.url;

      // Notifications: pending appointment → use Created notification
      const recipientUserIds = await getAppointmentNotificationRecipients(staffId);
      if (recipientUserIds.length > 0) {
        const inputs = recipientUserIds.map((uid) =>
          buildAppointmentCreatedNotification({
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

      // Email to client: acompte à payer with CTA
      const { manualDepositRequiredEmail } = await import("@/lib/email-templates");
      sendEmail({
        to: user.email,
        ...manualDepositRequiredEmail({
          customerName: user.fullName,
          serviceName,
          staffName,
          date: appointmentDate,
          time,
          depositAmount: amountToPay,
          totalAmount,
          paymentUrl,
        }),
      }).catch((err) => console.error("[createManualAppointment] deposit email failed:", err));

      // Staff email: keep them informed (pending)
      const emailRecipients = await getAppointmentEmailRecipients(staffId);
      for (const recipient of emailRecipients) {
        sendEmail({
          to: recipient.email,
          ...staffReservationRequestedEmail({
            staffName: recipient.fullName,
            customerName: user.fullName,
            serviceName,
            date: appointmentDate,
            time,
          }),
        }).catch((err) => console.error("[createManualAppointment] staff pending email failed:", err));
      }

      return {
        success: true,
        message: "Rendez-vous créé en attente du paiement de l'acompte. Un email a été envoyé au client.",
        data: { appointmentId: appointment.id, paymentUrl, status: "PENDING", requiresPayment: true },
      };
    }

    // ── Case 2: staff does NOT require an acompte → keep existing CONFIRMED flow ─
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

    // Notifications / email (fire-and-forget)
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
        totalAmount,
        checkInCode: ticket.checkInCode,
      }),
      ...(ticket.attachment ? { attachments: [ticket.attachment] } : {}),
    }).catch((err) => console.error("[createManualAppointment] confirmation email failed:", err));

    const emailRecipients = await getAppointmentEmailRecipients(staffId);
    for (const recipient of emailRecipients) {
      sendEmail({
        to: recipient.email,
        ...staffReservationConfirmedEmail({
          staffName: recipient.fullName,
          customerName: user.fullName,
          serviceName,
          date: appointmentDate,
          time,
          duration: staffService.duration,
          totalAmount,
        }),
      }).catch((err) => console.error("[createManualAppointment] staff email failed:", err));
    }

    return {
      success: true,
      message: "Rendez-vous ajouté avec succès.",
      data: { appointmentId: appointment.id, status: "CONFIRMED", requiresPayment: false },
    };
  } catch (error) {
    console.error("[createManualAppointment]", error);
    return { success: false, message: "Une erreur est survenue lors de la création du rendez-vous." };
  }
}
