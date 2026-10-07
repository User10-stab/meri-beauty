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
import { resolvePayeeForAppointment, payeePaymentData } from "@/lib/payments/resolve-payee";

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
 * @returns {Promise<{ success: boolean, data: Array<{ staffServiceId, staffId, staffName, price, duration, margin }>, message?: string }>}
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
        margin: true,
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
        // Rest time after the service — the form needs it to keep two
        // prestations of the same booking out of each other's margin.
        margin: Number(s.margin ?? 0),
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

const manualItemSchema = z.object({
  staffId: z.string().trim().optional().nullable(),
  staffServiceId: z.string().min(1, "La prestation est obligatoire."),
  date: z.string().min(1, "La date est obligatoire."),
  time: z.string().min(1, "L'heure est obligatoire."),
});

const MAX_MANUAL_ITEMS = 10;

const manualAppointmentsSchema = z.object({
  items: z
    .array(manualItemSchema)
    .min(1, "Ajoutez au moins une prestation.")
    .max(MAX_MANUAL_ITEMS, `Pas plus de ${MAX_MANUAL_ITEMS} prestations à la fois.`),
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
 * Validates one prestation of a manual booking without writing anything:
 * who may book it, the staff's payment rules, and the same availability
 * rules as the public online flow.
 *
 * @returns {Promise<{ error: object } | { leg: object }>}
 */
async function prepareManualLeg(session, item) {
  const { staffServiceId, date, time } = item;

  // ADMIN/OWNER must explicitly select a staff member; STAFF is auto-linked.
  if (isAdminRole(session.user.role) && !item.staffId) {
    return {
      error: {
        success: false,
        message: "Veuillez corriger les erreurs du formulaire.",
        errors: { staffId: "Le membre du personnel est obligatoire." },
      },
    };
  }

  const staffId = await resolveActingStaffId(session, item.staffId);
  if (!staffId) {
    return { error: { success: false, message: "Vous ne pouvez ajouter un rendez-vous que sur votre propre agenda." } };
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
    return { error: { success: false, message: "Prestation introuvable pour ce membre du personnel." } };
  }

  // ── Resolve payment decision for manual reservation ─────────────────────
  // Manual reservations are always CONFIRMED but payment rules still apply.
  // Each prestation is its own appointment with its own staff member, so the
  // decision is taken per prestation (appointmentCount stays 1).
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
    return { error: { success: false, message: "Ce créneau est déjà passé. Veuillez choisir un horaire à venir." } };
  }

  // findConflictingAppointment only rules out collision with another
  // appointment — it says nothing about closures, staff time off, working
  // hours, or contract dates. Re-validate against the same rules the manual
  // booking form itself uses to offer slots, so the final check is identical
  // to the online flow and a slot taken in the meantime can't slip through.
  const conflict = await findConflictingAppointment(staffServiceId, appointmentDate, startTime, endTime);
  if (conflict) {
    return { error: { success: false, message: "Ce créneau vient d'être réservé. Veuillez sélectionner un autre horaire." } };
  }

  const slotCheck = await validateAppointmentSlot(staffServiceId, appointmentDate, startTime, time);
  if (!slotCheck.valid) {
    return { error: { success: false, message: slotCheck.message } };
  }

  // Checked here rather than at creation so that a booking of several
  // prestations is refused before any of them is written.
  if (paymentDecision.shouldCreatePaymentRecord && paymentDecision.requiresOnlinePaymentNow) {
    if (!(await isSellerLegalDataComplete())) {
      return { error: { success: false, message: "Le paiement en ligne n'est pas disponible pour le moment." } };
    }
    const staffStripe = staffService.staff;
    if (!staffStripe?.stripeAccountId || !staffStripe.stripeChargesEnabled || !staffStripe.stripePayoutsEnabled) {
      return { error: { success: false, message: "Le compte Stripe du professionnel n'est pas prêt à recevoir des paiements." } };
    }
  }

  return { leg: { staffId, staffServiceId, staffService, paymentDecision, time, appointmentDate, startTime, endTime } };
}

/**
 * Two prestations of the same booking, with the same staff member, overlap
 * when one starts before the other is over *including its rest time*
 * (StaffService.margin) — the same rule buildOccupiedIntervals applies to
 * appointments already in the database, which these are not yet.
 */
function manualLegsOverlap(a, b) {
  if (a.staffId !== b.staffId) return false;
  const occupiedEndA = new Date(a.endTime);
  occupiedEndA.setMinutes(occupiedEndA.getMinutes() + Number(a.staffService.margin ?? 0));
  const occupiedEndB = new Date(b.endTime);
  occupiedEndB.setMinutes(occupiedEndB.getMinutes() + Number(b.staffService.margin ?? 0));
  return a.startTime < occupiedEndB && b.startTime < occupiedEndA;
}

/**
 * Resolves the customer of a manual booking — an existing account picked in
 * the form, or a brand-new one. Runs once per booking, however many
 * prestations it holds.
 *
 * @returns {Promise<{ error: object } | { user: object }>}
 */
async function resolveManualCustomer(customer) {
  if ("userId" in customer) {
    const user = await prisma.user.findUnique({
      where: { id: customer.userId, isDeleted: false, role: "CUSTOMER" },
    });
    if (!user) {
      return { error: { success: false, message: "Client introuvable." } };
    }
    return { user };
  }

  // Manual "new client" must neither duplicate nor silently reuse an
  // existing account: if the e-mail already belongs to an active client,
  // refuse and point at the existing-client picker instead (same
  // active-only rule as checkEmailExists and the partial unique indexes —
  // a soft-deleted account never blocks reuse of its e-mail). This check
  // stays in the manual flow only: the public flow intentionally reuses
  // the matching account via resolveOrCreateCustomer below.
  const emailInUse = await prisma.user.findFirst({
    where: { email: customer.email.trim().toLowerCase(), isDeleted: false },
    select: { id: true },
  });
  if (emailInUse) {
    const message =
      "Cette adresse e-mail est déjà utilisée par un client existant. Veuillez sélectionner le client existant plutôt que de créer un nouveau compte.";
    return { error: { success: false, field: "email", errors: { customer: message }, message } };
  }

  let user;
  let isNewUser = false;
  let temporaryPassword = null;
  try {
    ({ user, isNewUser, temporaryPassword } = await resolveOrCreateCustomer(
      { ...customer, newsletterSubscribed: false },
      undefined
    ));
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      return { error: { success: false, message: "Session expirée, veuillez réessayer." } };
    }
    if (err instanceof PhoneAlreadyRegisteredError) {
      return {
        error: {
          success: false,
          field: "phone",
          message: "Ce numéro de téléphone est déjà associé à un autre compte.",
        },
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

  return { user };
}

/**
 * Writes one validated prestation as its own appointment and sends its own
 * e-mails: one to the client, one to each recipient of that staff member.
 * A booking of several prestations is this, once per prestation — every
 * appointment keeps its own check-in ticket, and its own acompte link when
 * that staff member requires one.
 *
 * @returns {Promise<{ appointmentId: string, status: string, requiresPayment: boolean, paymentUrl?: string }>}
 */
async function createManualLeg(leg, user, notes) {
  const { staffId, staffServiceId, staffService, paymentDecision, time, appointmentDate, startTime, endTime } = leg;

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
          ...payeePaymentData(await resolvePayeeForAppointment(tx, { staffId })),
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
      data: { transactionReference: checkoutSession.id, stripeAccountId: staffService.staff.stripeAccountId },
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

    return { appointmentId: appointment.id, paymentUrl, status: "PENDING", requiresPayment: true };
  }

  // ── Case 2: staff does NOT require an acompte now → status still comes
  // from paymentDecision, not a literal. Currently always resolves to
  // CONFIRMED for this call site (every PENDING outcome of
  // getReservationPaymentDecision's isManualReservation branch requires
  // online payment now, so it's caught by Case 1 above) — but deriving it
  // keeps that true by construction instead of by two branches staying in
  // sync by hand.
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

  return { appointmentId: appointment.id, status: "CONFIRMED", requiresPayment: false };
}

/**
 * Lets staff/admin add a booking directly from the dashboard calendar — a
 * phone booking or walk-in that never went through the public site — made of
 * one or several prestations for the same client, with the same staff member
 * or different ones, on the same day or not.
 *
 * Every prestation becomes its own appointment and enforces the exact same
 * availability rules as the public online flow (working hours, closures,
 * time-off, contract dates, double-booking). On top of that, two prestations
 * of the same booking with the same staff member may not overlap, rest time
 * included. Everything is validated before anything is written.
 *
 * Each appointment follows its own staff member's payment rules (deposit,
 * online payment, cash payment) and is CONFIRMED unless that staff member
 * requires an online payment first. The client receives one e-mail per
 * prestation and each staff member one e-mail per prestation of hers.
 *
 * @param {{
 *   items: Array<{ staffId: string, staffServiceId: string, date: string, time: string }>,
 *   notes?: string,
 *   customer: { userId: string } | { fullName: string, email: string, phone: string },
 * }} input
 */
export async function createManualAppointments(input) {
  try {
    const session = await auth();
    if (!session?.user || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS))) {
      return { success: false, message: "Non autorisé." };
    }

    const parsed = manualAppointmentsSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors = {};
      let itemIndex;
      parsed.error.issues.forEach((err) => {
        // items.<n>.<field> reports under the field's own name, as it did
        // when the form held a single prestation.
        const isItemField = err.path[0] === "items" && err.path.length > 2;
        if (isItemField && itemIndex === undefined) itemIndex = err.path[1];
        fieldErrors[isItemField ? err.path[2] : err.path[0]] = err.message;
      });
      return { success: false, message: "Veuillez corriger les erreurs du formulaire.", errors: fieldErrors, itemIndex };
    }

    const { items, notes, customer } = parsed.data;
    const several = items.length > 1;
    const labelled = (index, message) => (several ? `Prestation ${index + 1} : ${message}` : message);

    // ── Validate every prestation before writing any of them ─────────────
    const legs = [];
    for (let i = 0; i < items.length; i++) {
      const prepared = await prepareManualLeg(session, items[i]);
      if (prepared.error) {
        return { ...prepared.error, message: labelled(i, prepared.error.message), itemIndex: i };
      }
      legs.push(prepared.leg);
    }

    // Each prestation was checked against the appointments already in the
    // database — not against the other prestations of this same booking,
    // which do not exist yet.
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        if (manualLegsOverlap(legs[i], legs[j])) {
          return {
            success: false,
            itemIndex: j,
            message: `Les prestations ${i + 1} et ${j + 1} se chevauchent pour le même membre du personnel (temps de repos compris). Veuillez choisir un autre horaire.`,
          };
        }
      }
    }

    const resolved = await resolveManualCustomer(customer);
    if (resolved.error) return resolved.error;
    const { user } = resolved;

    const created = [];
    for (let i = 0; i < legs.length; i++) {
      try {
        created.push(await createManualLeg(legs[i], user, notes));
      } catch (error) {
        if (created.length === 0) throw error;
        // Already-written appointments have had their e-mails sent; say
        // exactly where it stopped rather than pretending nothing happened.
        console.error("[createManualAppointment] prestation failed after earlier ones were created:", error);
        return {
          success: false,
          partial: true,
          itemIndex: i,
          message: `${created.length} rendez-vous ${created.length > 1 ? "ont été créés" : "a été créé"}, mais la prestation ${i + 1} n'a pas pu être enregistrée. Vérifiez son créneau et réessayez pour les prestations restantes.`,
          data: { appointments: created },
        };
      }
    }

    const awaitingPayment = created.filter((c) => c.requiresPayment).length;
    let message;
    if (!several) {
      message = awaitingPayment
        ? "Rendez-vous créé en attente du paiement de l'acompte. Un email a été envoyé au client."
        : "Rendez-vous ajouté avec succès.";
    } else if (awaitingPayment) {
      message = `${created.length} rendez-vous ajoutés, dont ${awaitingPayment} en attente du paiement de l'acompte. Un email a été envoyé au client.`;
    } else {
      message = `${created.length} rendez-vous ajoutés avec succès.`;
    }

    return { success: true, message, data: { appointments: created } };
  } catch (error) {
    console.error("[createManualAppointment]", error);
    return { success: false, message: "Une erreur est survenue lors de la création du rendez-vous." };
  }
}

/**
 * Single-prestation form of createManualAppointments, kept for callers that
 * book exactly one.
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
  const { staffId, staffServiceId, date, time, ...rest } = input ?? {};
  const result = await createManualAppointments({ ...rest, items: [{ staffId, staffServiceId, date, time }] });
  if (!result.success) return result;
  return { ...result, data: result.data.appointments[0] };
}
