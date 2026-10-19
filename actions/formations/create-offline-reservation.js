"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { STAFF_PERMISSIONS, canUseSalonTill, hasDashboardPermission } from "@/lib/authorization";
import { COUNTER_SELLABLE_CATALOGUE_STATUSES, isCounterSellableCatalogueStatus } from "@/lib/counter/catalogue-availability";
import { OCCUPANCY_KINDS, sessionOccupancy } from "@/lib/reservations/session-occupancy";
import { resolvePayeeForFormationSession, payeePaymentData } from "@/lib/payments/resolve-payee";
import { resolveServiceVatPolicy, repriceTtcCataloguePrice, hasInvoiceableVatIdentity, isPeppolMandatoryCustomer } from "@/lib/tax-policy";
import { issueInvoice, buildInvoiceCustomer, buildServiceInvoiceLines } from "@/lib/invoicing";
import { allocatePaymentTicketNumber } from "@/lib/tickets/allocate-ticket-number";
import { ensureCheckInCode, CHECK_IN_KINDS } from "@/lib/activities/check-in-code";
import { qrPngAttachment } from "@/lib/qrcode";
import { sendEmail } from "@/lib/email";
import { formationReservationConfirmationEmail } from "@/lib/email-templates";
import { sendFormationLowSeatsBroadcast } from "@/lib/formations/notify-low-seats";
import { notifyFormationStaffOfPaidReservation } from "@/lib/formations/notify-formation-staff";
import { customSessionConflict, formatSessionDateRange, resolveCustomDateRequest } from "@/lib/formations/custom-date-availability";
import { calculateOfflineFormationPayment } from "@/lib/formations/offline-payment";
import { staffFormationScope, staffSessionScope } from "@/lib/formations/offline-enrolment-scope";
import { revalidatePath } from "next/cache";

const enrollmentSchema = z.object({
  // Either a scheduled session, or — private formation only — the date picked
  // with the student (« date libre »), turned into her own session exactly
  // like the till does (actions/counter/create-reservation.js).
  sessionId: z.string().trim().min(1).optional(),
  customDate: z
    .object({
      formationId: z.string().min(1),
      date: z.string(),
      time: z.string(),
      days: z.number().int().min(1),
      // The journées the form displayed — refused if the calendar moved since.
      dates: z.array(z.string()).max(30),
    })
    .optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  paymentMode: z.enum(["DEPOSIT", "FULL"]),
  paymentConfirmed: z.literal(true),
});

function sessionLabel(session) {
  const range = formatSessionDateRange(session);
  return range.multiDay ? `${range.days} (${range.hours})` : new Date(session.startDate).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

/**
 * Record a formation student entered by staff. A bank transfer is treated as
 * already received here; this is intentionally separate from the till's
 * "virement attendu" flow.
 */
export async function createOfflineFormationReservation(input) {
  const parsed = enrollmentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Vérifiez le nom, la séance et le paiement reçu." };
  }

  const actorSession = await auth();
  if (!actorSession?.user) return { success: false, message: "Non authentifié." };
  const [canUseTill, canReserve] = await Promise.all([
    canUseSalonTill(actorSession.user),
    hasDashboardPermission(actorSession.user, STAFF_PERMISSIONS.FORMATION_RESERVATIONS),
  ]);
  if (!canUseTill || !canReserve) return { success: false, message: "Accès non autorisé." };

  const data = parsed.data;
  if (Boolean(data.sessionId) === Boolean(data.customDate)) {
    return { success: false, message: "Choisissez une séance ou une date libre." };
  }

  // « Date libre »: checked against the trainer's calendar exactly like the
  // website and the till; the session itself is created in the transaction.
  let customRequest = null;
  let customFormation = null;
  if (data.customDate) {
    const scope = staffFormationScope(actorSession.user);
    customFormation = await prisma.formation.findFirst({
      where: {
        id: data.customDate.formationId,
        type: "PRIVATE",
        status: { in: COUNTER_SELLABLE_CATALOGUE_STATUSES },
        ...(scope ?? {}),
      },
      select: { id: true, type: true, status: true, duration: true, animatorId: true, createdById: true },
    });
    if (!customFormation) {
      return { success: false, message: "Seule une formation privée peut être réservée à une date libre." };
    }
    customRequest = await resolveCustomDateRequest(prisma, { formation: customFormation, customDate: data.customDate });
    if (!customRequest.ok) return { success: false, message: customRequest.message };
  }

  const email = data.email?.trim().toLowerCase() || null;
  const submittedName = `${data.firstName} ${data.lastName}`.trim();
  let result;

  try {
    result = await prisma.$transaction(async (tx) => {
      let sessionId = data.sessionId;
      if (customRequest) {
        // The student's own date becomes her own session, re-checked against
        // the trainer's calendar under the lock before anything is recorded.
        const requested = await tx.formationSession.create({
          data: {
            formationId: customFormation.id,
            animatorId: customRequest.animatorId,
            startDate: customRequest.startDate,
            endDate: customRequest.endDate,
            capacity: 1,
            customerRequested: true,
            customDateKeys: customRequest.dateKeys,
          },
        });
        const taken = await customSessionConflict(tx, {
          ...requested,
          formation: { animatorId: customFormation.animatorId, createdById: customFormation.createdById },
        });
        if (taken) throw new Error("CUSTOM_DATE_TAKEN");
        sessionId = requested.id;
      }

      await tx.$queryRaw`SELECT id FROM formation_sessions WHERE id = ${sessionId} FOR UPDATE`;

      const scope = staffSessionScope(actorSession.user);
      const session = await tx.formationSession.findFirst({
        where: {
          id: sessionId,
          status: "SCHEDULED",
          // A date a client picked for herself is hers alone — only the one
          // created just above may be booked here.
          customerRequested: Boolean(customRequest),
          AND: [
            { OR: [{ endDate: { gt: new Date() } }, { endDate: null, startDate: { gt: new Date() } }] },
            { formation: { status: { in: COUNTER_SELLABLE_CATALOGUE_STATUSES } } },
            ...(scope ? [scope] : []),
          ],
        },
        include: {
          formation: {
            select: { id: true, title: true, type: true, price: true, depositPercentage: true, capacity: true, status: true },
          },
        },
      });
      if (!session || !isCounterSellableCatalogueStatus(session.formation.status)) {
        throw new Error("SESSION_NOT_AVAILABLE");
      }
      const payee = await resolvePayeeForFormationSession(tx, { sessionId: session.id });
      if (payee.payeeStaffId) throw new Error("INDEPENDENT_FORMATION");

      const capacity = session.capacity ?? session.formation.capacity;
      if (!Number.isInteger(capacity) || capacity < 1) throw new Error("INVALID_SESSION_CAPACITY");
      const takenSeats = await sessionOccupancy(tx, { kind: OCCUPANCY_KINDS.FORMATION, sessionId: session.id });
      if (takenSeats + 1 > capacity) throw new Error("SESSION_FULL");

      let student = email
        ? await tx.user.findFirst({
            where: { email: { equals: email, mode: "insensitive" }, isDeleted: false },
          })
        : null;
      if (student && student.role !== "CUSTOMER") throw new Error("EMAIL_IN_USE_BY_NON_CUSTOMER");
      if (!student) {
        student = await tx.user.create({
          data: {
            fullName: submittedName,
            email,
            password: null,
            phone: null,
            role: "CUSTOMER",
            emailVerified: false,
            isActive: true,
          },
        });
      }

      if (student.vatNumber && !student.addressLine1) throw new Error("CUSTOMER_BILLING_ADDRESS_REQUIRED");
      const vatPolicy = resolveServiceVatPolicy({ customer: student });
      const total = repriceTtcCataloguePrice(Number(session.formation.price), vatPolicy.vatRate);
      const { totalAmount, paidAmount, balanceDue, isFullPayment } = calculateOfflineFormationPayment(
        total,
        session.formation.depositPercentage,
        data.paymentMode,
      );
      if (totalAmount <= 0 || paidAmount <= 0) throw new Error("INVALID_PAYMENT_AMOUNT");

      const reservation = await tx.formationReservation.create({
        data: {
          sessionId: session.id,
          customerId: student.id,
          offlineEnrollment: true,
          seatsCount: 1,
          totalPrice: totalAmount,
          depositAmount: paidAmount,
          balanceDue,
          status: "CONFIRMED",
        },
      });

      const payment = await tx.payment.create({
        data: {
          formationReservationId: reservation.id,
          ...payeePaymentData(payee),
          depositAmount: isFullPayment ? 0 : paidAmount,
          totalAmount,
          paidAmount,
          remainingAmount: balanceDue,
          paymentType: isFullPayment ? "ON_SITE" : "DEPOSIT",
          status: isFullPayment ? "PAID" : "PARTIALLY_PAID",
          paidAt: new Date(),
        },
      });

      await tx.transaction.create({
        data: {
          paymentId: payment.id,
          amount: paidAmount,
          method: "TRANSFER",
          transactionType: isFullPayment ? "FINAL_PAYMENT" : "DEPOSIT",
          paidAt: new Date(),
        },
      });

      if (isFullPayment) {
        await allocatePaymentTicketNumber(tx, payment.id, "FORMATION");
      }

      const invoice = isFullPayment && hasInvoiceableVatIdentity(student)
        ? await issueInvoice(tx, {
            paymentId: payment.id,
            source: "FORMATION",
            totalInclVat: totalAmount,
            customer: buildInvoiceCustomer(student),
            lines: buildServiceInvoiceLines({ description: `${session.formation.title} (1 place)`, totalAmount }),
          })
        : null;

      await tx.auditLog.create({
        data: {
          actorId: actorSession.user.id,
          actorRole: actorSession.user.role,
          action: "formation_reservation.created_offline",
          entityType: "FormationReservation",
          entityId: reservation.id,
          after: {
            status: "CONFIRMED",
            sessionId: session.id,
            seatsCount: 1,
            paymentMode: data.paymentMode,
            paymentMethod: "TRANSFER",
            paidAmount,
            balanceDue,
            offlineEnrollment: true,
          },
        },
      });

      return {
        reservationId: reservation.id,
        customDate: Boolean(customRequest),
        paymentId: payment.id,
        sessionId: session.id,
        session,
        customerName: student.fullName,
        customerEmail: student.email,
        paidAmount,
        totalAmount,
        balanceDue,
        isFullPayment,
        invoiceNumber: invoice?.number ?? null,
        invoiceViaPeppol: Boolean(invoice && isPeppolMandatoryCustomer(student)),
      };
    }, { timeout: 15_000 });
  } catch (error) {
    const messages = {
      SESSION_NOT_AVAILABLE: "Cette séance n'est plus disponible pour une inscription.",
      INDEPENDENT_FORMATION: "Cette formation est encaissée par une formatrice indépendante ; l'inscription hors ligne par virement salon n'est pas disponible.",
      INVALID_SESSION_CAPACITY: "La capacité de cette séance est invalide.",
      SESSION_FULL: "Cette séance est complète.",
      CUSTOM_DATE_TAKEN: "Cette date n'est plus libre dans l'agenda de la formatrice. Choisissez-en une autre.",
      EMAIL_IN_USE_BY_NON_CUSTOMER: "Cette adresse e-mail appartient déjà à un compte non-client.",
      CUSTOMER_BILLING_ADDRESS_REQUIRED: "Le compte associé à cet e-mail doit d'abord avoir une adresse de facturation enregistrée.",
      INVALID_PAYMENT_AMOUNT: "Le prix et le montant de l'acompte doivent être supérieurs à zéro pour enregistrer un virement.",
      SELLER_LEGAL_DATA_INCOMPLETE: "Identité légale du salon incomplète — complétez Réglages > Salon avant d'émettre une facture.",
    };
    if (error?.code === "P2002" && email) {
      return { success: false, message: "Cette adresse e-mail vient d'être utilisée par un autre compte. Réessayez avec les informations à jour." };
    }
    if (messages[error?.message]) return { success: false, message: messages[error.message] };
    console.error("[createOfflineFormationReservation]", error);
    return { success: false, message: "Impossible d'enregistrer cette inscription." };
  }

  const checkInCode = await ensureCheckInCode(prisma, CHECK_IN_KINDS.FORMATION, result.reservationId).catch((error) => {
    console.error("[createOfflineFormationReservation] check-in code generation failed:", error);
    return null;
  });

  let emailSent = false;
  if (result.customerEmail) {
    const ticketQr = checkInCode
      ? await qrPngAttachment(checkInCode, `billet-formation-${checkInCode}.png`).catch(() => null)
      : null;
    const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { phone: true, email: true } });
    const pendingInvoiceNote = result.invoiceNumber
      ? result.invoiceViaPeppol
        ? `Votre facture officielle (n°${result.invoiceNumber}) vous sera transmise séparément via le réseau Peppol, conformément à la réglementation belge.`
        : `Votre facture officielle (n°${result.invoiceNumber}) vous sera transmise séparément par e-mail.`
      : "";
    const emailResult = await sendEmail({
      to: result.customerEmail,
      ...formationReservationConfirmationEmail({
        customerName: result.customerName,
        formationTitle: result.session.formation.title,
        sessionDate: sessionLabel(result.session),
        seatsCount: 1,
        paidAmount: result.paidAmount,
        totalAmount: result.totalAmount,
        balanceDue: result.balanceDue,
        isFullPayment: result.isFullPayment,
        salonPhone: salon?.phone,
        salonEmail: salon?.email,
        pendingInvoiceNote,
        checkInCode,
        offlineEnrollment: true,
      }),
      ...(ticketQr ? { attachments: [ticketQr] } : {}),
    }).catch((error) => {
      console.error("[createOfflineFormationReservation] confirmation email failed:", error);
      return { success: false };
    });
    emailSent = Boolean(emailResult?.success);
  }

  const sold = await prisma.formationReservation.findUnique({
    where: { id: result.reservationId },
    include: { customer: true, session: { include: { formation: true } } },
  });
  if (sold) {
    const range = formatSessionDateRange(sold.session);
    notifyFormationStaffOfPaidReservation(sold, {
      sessionDate: sessionLabel(sold.session),
      sessionRange: range,
      paidAmount: result.paidAmount,
      totalAmount: result.totalAmount,
      isFullPayment: result.isFullPayment,
    }).catch((error) => console.error("[createOfflineFormationReservation] staff email failed:", error));
  }

  // A date libre is one student's own session: no seats to announce.
  if (!result.customDate) {
    sendFormationLowSeatsBroadcast(result.sessionId).catch((error) =>
      console.error("[createOfflineFormationReservation] low-seats broadcast failed:", error)
    );
  }

  revalidatePath("/dashboard/formations/reservations");
  revalidatePath("/dashboard/operations");
  revalidatePath("/dashboard/factures");
  revalidatePath("/dashboard/livre-de-recettes");

  return {
    success: true,
    message: emailSent
      ? "Inscription enregistrée et confirmation envoyée par e-mail."
      : result.customerEmail
        ? "Inscription enregistrée ; l'e-mail de confirmation n'a pas pu être envoyé."
        : "Inscription enregistrée. Aucun e-mail n'a été envoyé car aucune adresse n'a été renseignée.",
    emailSent,
    data: {
      reservationId: result.reservationId,
      customerName: result.customerName,
      checkInCode,
      totalAmount: result.totalAmount,
      paidAmount: result.paidAmount,
      balanceDue: result.balanceDue,
      invoiceNumber: result.invoiceNumber,
    },
  };
}
