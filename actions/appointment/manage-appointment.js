"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ROLES, isAdminRole, hasDashboardPermission, STAFF_PERMISSIONS, canUseSalonTill } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";
import { sendEmail } from "@/lib/email";
import { createAppointmentConfirmToken } from "@/lib/appointment-confirm-token";
import { reservationAcceptedEmail, reservationRejectedEmail } from "@/lib/email-templates";
import { issueCreditNote, issueInvoice, buildInvoiceCustomer, buildServiceInvoiceLines, resolveSettlementInvoice } from "@/lib/invoicing";
import { allocatePieceNumber, PIECE_SERIES } from "@/lib/cash-book/piece-number";
import { allocatePaymentTicketNumber } from "@/lib/tickets/allocate-ticket-number";
import { allocateBookingTerminalReference } from "@/lib/payments/terminal-reference";
import { AWAITED_TRANSFER_METHOD, AWAITED_TRANSFER_OFF_TILL_MESSAGE, isAwaitedTransfer, markPaymentAwaitingTransfer } from "@/lib/payments/awaited-transfer";
import { COUNTER_QR_MESSAGES, COUNTER_QR_METHOD, COUNTER_QR_SURFACES, isCounterQr, verifyCounterQrPayment } from "@/lib/counter/qr-checkout";
import { resolveServiceVatPolicy, hasInvoiceableVatIdentity } from "@/lib/tax-policy";
import { queueManualRefund } from "@/lib/refunds/queue-manual-refund";
import { releaseAppointmentPromoUse } from "@/lib/promo-code-release";
import { isBusinessRefundCustomer } from "@/lib/refunds/document-policy";
import { authorizeRefundActor } from "@/lib/refunds/authorize";
import { isWithinCancellationWindow } from "@/lib/reservationRules";
import { revalidateCaisseRoutes } from "@/lib/cash-book/revalidate-caisse";
import { ensureCashSessionOpen } from "@/lib/cash-book/session-lifecycle";
import { resolveCounterPriceAdjustment } from "@/lib/payments/counter-price-adjustment";
import { AUDIT_ACTIONS } from "@/lib/audit-log";
import { sendSettlementEmail } from "@/lib/payments/send-settlement-email";
import {
  createNotificationsBulk,
  buildAppointmentCancelledNotification,
  buildAppointmentNoShowNotification,
  getAppointmentNotificationRecipients,
} from "@/lib/notifications";
import { resolvePayeeForAppointment, payeePaymentData } from "@/lib/payments/resolve-payee";

/**
 * Verify the authenticated user can manage the given appointment.
 * STAFF can only manage their own appointments.
 * @param {string} appointmentId
 * @returns {{ authorized: boolean, message?: string, staffServiceId?: string }}
 */
async function authorizeAppointmentAction(appointmentId) {
  const session = await auth();

  if (!session?.user) {
    return { authorized: false, message: "Authentification requise" };
  }

  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS))) {
    return { authorized: false, message: "Permission rendez-vous requise" };
  }

  const userRole = session.user.role;

  // ADMIN/OWNER can manage any appointment
  if (isAdminRole(userRole)) {
    return { authorized: true, userId: session.user.id, userRole, user: session.user };
  }

  // STAFF can only manage appointments linked to them
  if (userRole === ROLES.STAFF) {
    const staffId = await getCurrentStaffId();

    if (!staffId) {
      return { authorized: false, message: "Profil staff introuvable" };
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      select: {
        staffService: {
          select: { staffId: true },
        },
      },
    });

    if (!appointment) {
      return { authorized: false, message: "Rendez-vous introuvable" };
    }

    if (appointment.staffService.staffId !== staffId) {
      return { authorized: false, message: "Vous n'êtes pas autorisé à gérer ce rendez-vous" };
    }

    return { authorized: true, userId: session.user.id, userRole, user: session.user };
  }

  return { authorized: false, message: "Permissions insuffisantes" };
}

/**
 * Accepts a manual appointment request and sends the customer to the payment
 * choice page. Final confirmation happens only after the customer chooses an
 * on-site payment or Stripe confirms an online payment.
 * Called by the salon owner/staff from the dashboard.
 *
 * @param {string} appointmentId
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export async function acceptAppointment(appointmentId) {
  try {
    if (!appointmentId) {
      return { success: false, message: "ID de rendez-vous manquant" };
    }

    const authCheck = await authorizeAppointmentAction(appointmentId);
    if (!authCheck.authorized) {
      return { success: false, message: authCheck.message };
    }

    // Load appointment with related data
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        staffService: {
          include: {
            service: true,
            staff: {
              include: {
                user: {
                  select: { fullName: true },
                },
              },
            },
          },
        },
        payment: { select: { id: true, status: true } },
      },
    });

    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable" };
    }

    if (appointment.status !== "PENDING") {
      return {
        success: false,
        message: "Ce rendez-vous n'est pas en attente de confirmation",
      };
    }

    // A PENDING appointment with a Payment row belongs to the automatic
    // pay-now flow. Staff acceptance must never race or bypass its webhook.
    if (appointment.payment) {
      return {
        success: false,
        message: "Ce rendez-vous attend déjà la confirmation de son paiement Stripe.",
      };
    }

    const claim = await prisma.appointment.updateMany({
      where: { id: appointmentId, status: "PENDING", payment: null },
      data: { status: "ACCEPTED" },
    });
    const claimed = claim.count === 1;

    if (!claimed) {
      return {
        success: false,
        message: "Ce rendez-vous n'est pas en attente de confirmation",
      };
    }

    // The page reuses the shared payment decision engine server-side.
    // The link carries a dedicated, appointment-scoped confirmation token
    // (not a login/session token, and never the customer's email): it is
    // only ever delivered inside this email to the customer's own address,
    // so possession of it proves ownership of this one appointment. It is
    // verified server-side by the payment page, which authorizes the
    // confirmation action for that appointment without any login. Validity
    // is a week: the customer may open the email days after acceptance and
    // must still be able to confirm.
    const confirmToken = createAppointmentConfirmToken({
      appointmentId,
      email: appointment.user.email,
    });
    const paymentUrl = `${process.env.NEXT_PUBLIC_APP_URL}/appointment/${appointmentId}/payment?confirm=${encodeURIComponent(confirmToken)}`;

    // Send one focused acceptance email; payment choices belong to the linked flow.
    const staff = appointment.staffService?.staff;

    sendEmail({
      to: appointment.user.email,
      ...reservationAcceptedEmail({
        customerName: appointment.user.fullName,
        serviceName: appointment.staffService.service.name,
        staffName: appointment.staffService.staff?.user?.fullName || "Expert",
        date: appointment.date,
        time: appointment.startTime.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Brussels",
        }),
        confirmationUrl: paymentUrl,
      }),
    }).catch((err) =>
      console.error("[acceptAppointment] email failed:", err)
    );

    return {
      success: true,
      message: "Rendez-vous accepté et email envoyé au client",
    };
  } catch (error) {
    console.error("[acceptAppointment]", error);
    return {
      success: false,
      message: "Erreur lors de l'acceptation du rendez-vous",
    };
  }
}

/**
 * Rejects/cancels an appointment.
 * Called by the salon owner/staff from the dashboard.
 *
 * @param {string} appointmentId
 * @param {string} reason - Optional reason for rejection
 * @param {{
 *   waiveDepositForfeit?: boolean,
 *   forceManualRejection?: boolean,
 * }} [options] - forceManualRejection marks a PENDING request as refused even
 *   if the staff member's current mode isn't MANUAL. Normally the server
 *   derives it: PENDING + MANUAL staff => REJECTED, everything else => CANCELLED.
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export async function rejectAppointment(appointmentId, reason = null, { waiveDepositForfeit = false, forceManualRejection = false } = {}) {
  try {
    if (!appointmentId) {
      return { success: false, message: "ID de rendez-vous manquant" };
    }

    const authCheck = await authorizeAppointmentAction(appointmentId);
    if (!authCheck.authorized) {
      return { success: false, message: authCheck.message };
    }

    const cancellationReason =
      typeof reason === "string" && reason.trim()
        ? reason.trim().slice(0, 1000)
        : "Rendez-vous annulé depuis le tableau de bord";

    // Load appointment
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            vatNumber: true,
            vatValidatedAt: true,
            vatValidationName: true,
            addressLine1: true,
            addressLine2: true,
            addressCity: true,
            addressPostalCode: true,
            addressCountry: true,
            isCompany: true,
            billingProfile: {
              select: { companyLegalName: true, companyRegistrationNo: true, billingContactName: true, purchaseOrderReference: true },
            },
          },
        },
        staffService: {
          include: {
            service: { select: { name: true } },
            staff: {
              select: {
                reservationConfirmationMode: true,
                user: { select: { fullName: true } },
              },
            },
          },
        },
        payment: { include: { invoice: true, transactions: true } },
      },
    });

    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable" };
    }

    // A PENDING request on a MANUAL staff member is a request the salon is
    // turning down before ever accepting it — record it as REJECTED (its own
    // terminal status, with the dedicated rejection email) rather than
    // CANCELLED, which is for real bookings being withdrawn. Callers can
    // still force the flag, but the server derives it so the dashboard's
    // plain reject action maps to the right status without knowing about
    // confirmation modes.
    const isManualRejection =
      forceManualRejection === true ||
      (appointment.status === "PENDING" &&
        String(appointment.staffService?.staff?.reservationConfirmationMode ?? "MANUAL").toUpperCase() ===
          "MANUAL");

    const payment = appointment.payment;
    const wasPaid = Boolean(payment) && ["PAID", "PARTIALLY_PAID"].includes(payment.status);

    // Cancelling an unpaid request is routine appointment management (STAFF
    // may do it for their own appointments, per authorizeAppointmentAction
    // above) — but cancelling a paid one triggers a real Stripe refund, which
    // per policy only OWNER/ADMIN may issue, with no staff exemption: the
    // site promises customers a late deposit "reste acquis sauf annulation
    // exceptionnelle approuvée par l'administration" (see migration
    // 20260812190000), so the same late cancellation must never refund 100%
    // just because the assigned staff member (rather than an admin) clicked
    // cancel — only admin decides whether to waive the forfeit
    // (waiveDepositForfeit below).
    //
    // An independent practitioner's own sale (Payment.payeeStaffId) is the
    // exception, the other way round: the money is on her Stripe account and
    // under her VAT number, so she alone cancels and refunds it — including
    // waiving her own forfeit — and the admin is refused (authorizeRefundActor).
    if (wasPaid) {
      if (payment.payeeStaffId) {
        const owner = authorizeRefundActor({
          actorRole: authCheck.userRole,
          actorStaffId: isAdminRole(authCheck.userRole) ? null : await getCurrentStaffId(),
          payeeStaffId: payment.payeeStaffId,
        });
        if (!owner.allowed) return { success: false, message: owner.message };
      } else {
        const session = await auth();
        if (!isAdminRole(session?.user?.role)) {
          return {
            success: false,
            message: "Seul un administrateur peut annuler un rendez-vous déjà payé (remboursement requis). Contactez un administrateur.",
          };
        }
      }
    }

    // Without an auto-close job (see lib/appointments/notify-unsettled-appointments.js
    // for why one doesn't exist), a CONFIRMED appointment can otherwise stay
    // cancellable-with-full-refund indefinitely — even months after the
    // fact. Past this point a no-show should go through markAppointmentNoShow
    // (no refund) or a manual reconciliation, not an automatic Stripe refund
    // for a rendez-vous nobody remembers the outcome of.
    const STALE_CANCELLATION_GUARD_DAYS = 7;
    if (wasPaid && appointment.endTime && Date.now() - appointment.endTime.getTime() > STALE_CANCELLATION_GUARD_DAYS * 24 * 60 * 60 * 1000) {
      return {
        success: false,
        message: `Ce rendez-vous date de plus de ${STALE_CANCELLATION_GUARD_DAYS} jours — utilisez « Marquer absente » ou une régularisation manuelle plutôt qu'une annulation avec remboursement automatique.`,
      };
    }

    // Cap against what's actually still outstanding — a prior partial refund
    // (e.g. issued manually from the Stripe Dashboard, reconciled here via
    // the charge.refunded webhook) can already have refunded part of this
    // payment. Summing (not just checking existence of) prior REFUND
    // transactions is what stops this from either over-crediting past the
    // invoice total or silently skipping the remaining balance once any
    // refund exists at all — mirrors completeReturnRequest's exact pattern.
    const REFUND_EPSILON = 0.01;
    let remaining = 0;
    if (wasPaid) {
      const priorRefunds = await prisma.transaction.aggregate({
        where: { paymentId: payment.id, transactionType: "REFUND" },
        _sum: { amount: true },
      });
      const alreadyRefunded = Number(priorRefunds._sum.amount ?? 0);
      remaining = Number(payment.paidAmount) - alreadyRefunded;
    }

    // A late cancellation (inside the 48h window a customer can no longer
    // self-cancel through, so it's processed here instead, e.g. by phone)
    // withholds a configurable share of a deposit-type payment.
    // depositForfeitPercentage defaults to 100 (migration 20260812190000) —
    // the deposit stays acquired by default, matching what customers are
    // told, unless an admin explicitly waives it via waiveDepositForfeit.
    // Only applies to deposit payments, not a full/balance payment. Reaching
    // this point at all already implies an admin is cancelling — the wasPaid
    // gate above no longer lets assigned staff through, so there's no
    // separate staff-exemption to apply here.
    //
    // Declining a request the salon never accepted is the exception. A
    // PENDING appointment can carry a payment (an automatic pay-now booking
    // mid-settlement), and a staff member turning it down must never pocket
    // the forfeit for a slot they refused — the forfeit exists to cover a
    // late *customer* cancellation, not a salon decision. A still-PENDING
    // request has never been committed to by anyone, so it always refunds in
    // full.
    const isDeclineOfUnacceptedRequest = appointment.status === "PENDING";

    // markAppointmentNoShow already recorded this payment as fully,
    // non-refundably forfeited (see its own doc comment) regardless of
    // paymentType — a FULL_ONLINE no-show is forfeited exactly like a
    // DEPOSIT one. Cancelling it afterward (e.g. to close out the calendar
    // entry) must not reopen that decision: the DEPOSIT-only branch below
    // would otherwise skip the forfeit for anything but a deposit payment
    // and refund it in full, undoing the no-show policy.
    const isNoShowClosure = appointment.status === "NO_SHOW";

    let forfeitAmount = 0;
    if (wasPaid && isNoShowClosure) {
      forfeitAmount = remaining;
      remaining = 0;
    } else if (
      wasPaid &&
      appointment.status !== "COMPLETED" &&
      !isDeclineOfUnacceptedRequest &&
      payment.paymentType === "DEPOSIT" &&
      isWithinCancellationWindow(appointment.startTime) &&
      !waiveDepositForfeit
    ) {
      const forfeitPercentage = Number(appointment.staffService?.staff?.depositForfeitPercentage ?? 0);
      if (forfeitPercentage > 0) {
        forfeitAmount = Math.round(remaining * (forfeitPercentage / 100) * 100) / 100;
        remaining = Math.round((remaining - forfeitAmount) * 100) / 100;
      }
    }

    // Note this no longer requires payment.transactionReference: a rendez-vous
    // settled in cash at the counter used to fall through here refunding
    // nothing AND issuing no credit note (same bug already fixed in
    // cancelWorkshopReservation/cancelFormationReservation). Cash now queues
    // a hand-over leg like any other method.
    const needsRefund = wasPaid && remaining > REFUND_EPSILON;
    const cancellationReasonWithForfeit =
      forfeitAmount > REFUND_EPSILON
        ? `${cancellationReason} (acompte retenu : ${forfeitAmount.toFixed(2)} €)`
        : cancellationReason;

    const claimed = await prisma.$transaction(async (tx) => {
      // Atomic claim, gated on the appointment not already being cancelled —
      // without this, two concurrent rejects (double-click, or staff and a
      // webhook racing) both pass a plain read-then-check and both refund.
      const claim = await tx.appointment.updateMany({
        where: { id: appointmentId, status: { in: ["PENDING", "ACCEPTED", "CONFIRMED", "COMPLETED", "NO_SHOW"] } },
        data: {
          status: isManualRejection ? "REJECTED" : "CANCELLED",
          cancelledAt: new Date(),
          cancelledByUserId: authCheck.userId,
          cancellationReason: cancellationReasonWithForfeit,
          cancellationSource: isAdminRole(authCheck.userRole) ? "ADMIN" : "STAFF",
        },
      });
      if (claim.count === 0) return false;

      await releaseAppointmentPromoUse(tx, appointmentId);

      let creditNote = null;
      if (wasPaid && payment.invoice && remaining > REFUND_EPSILON) {
        creditNote = await issueCreditNote(tx, {
          invoiceId: payment.invoice.id,
          reason: cancellationReasonWithForfeit,
          totalInclVat: remaining,
        });
      }

      // The forfeited share of the deposit is money that's now finally,
      // non-refundably realized — it needs its own invoice, same as a
      // collected balance (completeAppointment) or a no-show deposit
      // (markAppointmentNoShow). A forfeited deposit will essentially never
      // already have payment.invoice set (deposits aren't invoiced at
      // collection time), but guard on it anyway for idempotency.
      // Never for an independent's sale — she documents it under her own VAT.
      if (forfeitAmount > REFUND_EPSILON && !payment.invoice && !payment.payeeStaffId && hasInvoiceableVatIdentity(appointment.user)) {
        const cancellationFeeVatPolicy = resolveServiceVatPolicy({ customer: appointment.user });
        await issueInvoice(tx, {
          paymentId: payment.id,
          source: "APPOINTMENT",
          totalInclVat: forfeitAmount,
          customer: buildInvoiceCustomer(appointment.user),
          lines: buildServiceInvoiceLines({
            description: `Frais d'annulation — ${appointment.staffService?.service?.name ?? "Prestation"}`,
            totalAmount: forfeitAmount,
          }),
          vatRate: cancellationFeeVatPolicy.vatRate,
          vatTreatment: cancellationFeeVatPolicy.vatTreatment,
          taxCountryCode: cancellationFeeVatPolicy.taxCountryCode,
          taxNote: cancellationFeeVatPolicy.taxNote,
        });
      }

      // Confirmed policy (2026-09-02): the application never issues a Stripe
      // refund itself — every card refund is performed by hand in the
      // Stripe dashboard by an OWNER/ADMIN. This records what is owed as a
      // RefundOperation whose legs carry the precise amount and
      // payment_intent to refund against; it surfaces on
      // /dashboard/operations until someone has actually done it, and the
      // charge.refunded webhook settles it.
      let refundQueued = false;
      if (needsRefund) {
        const queued = await queueManualRefund(tx, {
          paymentId: payment.id,
          source: "APPOINTMENT",
          trigger: "SALON_CANCELLATION",
          reason: cancellationReasonWithForfeit,
          amount: remaining,
          transactions: payment.transactions,
          creditNoteId: creditNote?.id ?? null,
          invoiceId: payment.invoice?.id ?? null,
          decidedByUserId: authCheck.userId,
          customerIsBusiness: isBusinessRefundCustomer(appointment.user),
        });
        refundQueued = Boolean(queued);
      }

      const serviceName = appointment.staffService?.service?.name;
      const customerName = appointment.user?.fullName;
      const recipientUserIds = await getAppointmentNotificationRecipients(appointment.staffId, { tx });

      if (recipientUserIds.length > 0) {
        await createNotificationsBulk(
          recipientUserIds.map((uid) =>
            buildAppointmentCancelledNotification({
              userId: uid,
              appointmentId: appointment.id,
              date: appointment.date,
              startTime: appointment.startTime,
              serviceName,
              reason,
              customerName,
            })
          ),
          { tx }
        );
      }

      return { claimed: true, creditNoteId: creditNote?.id ?? null, refundQueued };
    });

    if (!claimed?.claimed) {
      return { success: true, message: "Ce rendez-vous est déjà annulé." };
    }

    // Never "already refunded": nothing here calls Stripe, so the only two
    // honest states are "there is nothing owed" and "it is queued, waiting
    // on an admin to pay it back by hand or hand it over" — the customer is
    // told the money moved only once notify-refund-complete.js actually
    // confirms that, after settlement.
    const refundNote = claimed.refundQueued
      ? " Le remboursement est en cours de traitement par notre équipe — vous serez recontacté(e) si besoin."
      : "";

    // Use the proper email template based on whether this is a manual rejection or a cancellation
    if (isManualRejection) {
      sendEmail({
        to: appointment.user.email,
        ...reservationRejectedEmail({
          customerName: appointment.user.fullName,
          serviceName: appointment.staffService.service.name,
          staffName: appointment.staffService.staff?.user?.fullName || "Expert",
          date: appointment.date,
          time: appointment.startTime.toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Brussels",
          }),
          reason: reason || null,
        }),
      }).catch((err) => console.error("[rejectAppointment] rejection email failed:", err));
    } else {
      sendEmail({
        to: appointment.user.email,
        subject: "Rendez-vous annulé – Meri Beauty",
        text:
          `Bonjour ${appointment.user.fullName},\n\n` +
          `Votre rendez-vous du ${appointment.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} a été annulé.${refundNote}` +
          (reason ? ` Raison : ${reason}` : "") +
          `\n\nL'équipe Meri Beauty`,
        html:
          `<p>Bonjour ${appointment.user.fullName},</p>` +
          `<p>Votre rendez-vous du ${appointment.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} a été annulé.${refundNote}` +
          (reason ? ` Raison : ${reason}` : "") +
          `</p><p>L'équipe Meri Beauty</p>`,
      }).catch((err) => console.error("[rejectAppointment] cancellation email failed:", err));
    }

    return {
      success: true,
      message: isManualRejection
        ? "Demande de rendez-vous refusée"
        : wasPaid
          ? claimed.refundQueued
            ? "Rendez-vous annulé. Le remboursement est à effectuer — voir « Remboursements dus » dans Opérations."
            : "Rendez-vous annulé."
          : "Rendez-vous annulé",
      // Kept for actions/reservation/cancellation-exception-request.js, which
      // still reads this field — always false now, since a refund that
      // cannot be recorded throws inside the transaction above and the whole
      // cancellation rolls back with it, rather than half-succeeding.
      refundFailed: false,
      refundQueued: claimed.refundQueued,
    };
  } catch (error) {
    if (error.message === "REFUND_ALREADY_PENDING") {
      return { success: false, message: "Un remboursement est déjà en cours pour ce rendez-vous — attendez sa résolution avant de réessayer." };
    }
    console.error("[rejectAppointment]", error);
    return {
      success: false,
      message: "Erreur lors de l'annulation du rendez-vous",
    };
  }
}

/**
 * Marks a CONFIRMED appointment as a no-show. Unlike rejectAppointment, this
 * never issues a refund or calls Stripe — whatever was captured (deposit or
 * full payment) stays exactly as captured, no automatic refund in either
 * direction. Before this existed, the only way to close out a missed
 * appointment was "Annuler", which always issues a full refund and treats a
 * no-show identically to a business-initiated cancellation — rewarding the
 * absence instead of recording it.
 *
 * It does mark the Payment PAID and issue an invoice for the forfeited
 * deposit: that money is now finally, non-refundably realized the moment
 * the no-show is recorded, and taxable money changing hands with no invoice
 * is exactly the gap this closes (mirrors completeAppointment's balance
 * invoicing and rejectAppointment's late-cancellation forfeit invoicing).
 *
 * @param {string} appointmentId
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export async function markAppointmentNoShow(appointmentId) {
  try {
    if (!appointmentId) {
      return { success: false, message: "ID de rendez-vous manquant" };
    }

    const authCheck = await authorizeAppointmentAction(appointmentId);
    if (!authCheck.authorized) {
      return { success: false, message: authCheck.message };
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            vatNumber: true,
            vatValidatedAt: true,
            vatValidationName: true,
            addressLine1: true,
            addressLine2: true,
            addressCity: true,
            addressPostalCode: true,
            addressCountry: true,
            isCompany: true,
            billingProfile: {
              select: { companyLegalName: true, companyRegistrationNo: true, billingContactName: true, purchaseOrderReference: true },
            },
          },
        },
        staffService: { include: { service: { select: { name: true } } } },
        payment: { include: { invoice: true } },
      },
    });
    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable" };
    }
    // A future appointment hasn't happened yet — there's no "absence" to
    // record until the scheduled time has passed. Mirrors the same guard
    // on completeAppointment.
    if (appointment.startTime > new Date()) {
      return { success: false, message: "Ce rendez-vous n'a pas encore eu lieu — impossible de le marquer comme absence." };
    }

    const markedNote = `Marqué absent le ${new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })}`;
    // Resolved before the transaction: it reads the actor's permissions.
    const actorUsesTill = await canUseSalonTill(authCheck.user);

    const claimed = await prisma.$transaction(async (tx) => {
      // Atomic claim, gated on CONFIRMED — a no-show only makes sense for an
      // appointment the client was actually expected to attend, and only
      // once (a double-click or two staff acting at once can't both fire
      // the notification below).
      const claim = await tx.appointment.updateMany({
        where: { id: appointmentId, status: "CONFIRMED" },
        data: {
          status: "NO_SHOW",
          notes: appointment.notes ? `${appointment.notes}\n${markedNote}` : markedNote,
        },
      });
      if (claim.count === 0) return false;

      // The deposit is kept in full, by design, and never refunded — that
      // makes it finally, non-refundably realized revenue the moment the
      // no-show is recorded, same as a collected balance (completeAppointment)
      // or a forfeited late-cancellation deposit (rejectAppointment). Guard
      // on payment.invoice for idempotency, same reasoning as those.
      const noShowPayment = appointment.payment;
      if (
        noShowPayment &&
        !["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(noShowPayment.status) &&
        Number(noShowPayment.paidAmount) > 0.01 &&
        !noShowPayment.invoice
      ) {
        await tx.payment.update({
          where: { id: noShowPayment.id },
          data: { status: "PAID" },
        });
        // A non-privileged staff member (offTillActor) can never cause an
        // Invoice to be created — see canUseSalonTill. The no-show still
        // gets recorded and the deposit kept, it simply never gets an
        // invoice.
        const offTillActor = !actorUsesTill || Boolean(noShowPayment.payeeStaffId);
        await allocatePaymentTicketNumber(tx, noShowPayment.id, "APPOINTMENT", null, new Date(), offTillActor);

        if (hasInvoiceableVatIdentity(appointment.user) && !offTillActor) {
          const noShowVatPolicy = resolveServiceVatPolicy({ customer: appointment.user });
          await issueInvoice(tx, {
            paymentId: noShowPayment.id,
            source: "APPOINTMENT",
            totalInclVat: Number(noShowPayment.paidAmount),
            customer: buildInvoiceCustomer(appointment.user),
            lines: buildServiceInvoiceLines({
              description: `Absence — acompte non remboursable — ${appointment.staffService?.service?.name ?? "Prestation"}`,
              totalAmount: Number(noShowPayment.paidAmount),
            }),
            vatRate: noShowVatPolicy.vatRate,
            vatTreatment: noShowVatPolicy.vatTreatment,
            taxCountryCode: noShowVatPolicy.taxCountryCode,
            taxNote: noShowVatPolicy.taxNote,
          });
        }
      }

      const serviceName = appointment.staffService?.service?.name;
      const customerName = appointment.user?.fullName;
      const recipientUserIds = await getAppointmentNotificationRecipients(appointment.staffId, { tx });
      if (recipientUserIds.length > 0) {
        await createNotificationsBulk(
          recipientUserIds.map((uid) =>
            buildAppointmentNoShowNotification({
              userId: uid,
              appointmentId: appointment.id,
              date: appointment.date,
              startTime: appointment.startTime,
              serviceName,
              customerName,
            })
          ),
          { tx }
        );
      }

      return true;
    });

    if (!claimed) {
      return { success: false, message: "Ce rendez-vous ne peut plus être marqué absent (statut déjà modifié)." };
    }

    return { success: true, message: "Rendez-vous marqué comme absence. Aucun remboursement n'a été émis." };
  } catch (error) {
    console.error("[markAppointmentNoShow]", error);
    return { success: false, message: "Erreur lors du marquage de l'absence" };
  }
}

/**
 * Marks a CONFIRMED appointment as COMPLETED. For a deposit booking
 * (Payment.status === "PARTIALLY_PAID"), this is also where the on-site
 * balance gets collected and invoiced — previously there was no mechanism
 * at all to record that money or issue the legally-required invoice for
 * it, since the checkout webhook only invoices fully-paid-online bookings.
 *
 * `coverAppointmentIds` is « Terminer toute la visite » for one staff member:
 * other prestations of the same visit, with this same staff member, that are
 * cashed HERE — one Payment, one Transaction, one ticket, one row in
 * Opérations — and closed in the same transaction. Each of them then points
 * at this appointment's Payment (Appointment.coveredByPaymentId) and never
 * gets one of its own. Only prestations that carry no Payment yet can be
 * covered; one that already took an acompte online settles its own balance.
 * See completeVisit below, the only caller that passes it.
 *
 * @param {string} appointmentId
 * @param {{ method?: "CASH" | "EXTERNAL_TERMINAL", terminalApproved?: boolean, coverAppointmentIds?: string[] }} [options] - method is required only
 *   when a balance is actually due.
 */
export async function completeAppointment(
  appointmentId,
  { method, paymentConfirmed, terminalApproved, qrSessionId, finalTotal, adjustmentReason, coverAppointmentIds } = {}
) {
  try {
    if (!appointmentId) {
      return { success: false, message: "ID de rendez-vous manquant" };
    }

    const authCheck = await authorizeAppointmentAction(appointmentId);
    if (!authCheck.authorized) {
      return { success: false, message: authCheck.message };
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
            vatNumber: true,
            vatValidatedAt: true,
            vatValidationName: true,
            addressLine1: true,
            addressLine2: true,
            addressCity: true,
            addressPostalCode: true,
            addressCountry: true,
            isCompany: true,
            billingProfile: {
              select: { companyLegalName: true, companyRegistrationNo: true, billingContactName: true, purchaseOrderReference: true },
            },
          },
        },
        staffService: { include: { service: true } },
        payment: { include: { invoice: true } },
      },
    });

    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable" };
    }
    if (appointment.status !== "CONFIRMED") {
      return { success: false, message: "Seul un rendez-vous confirmé peut être marqué comme terminé." };
    }
    // A future appointment hasn't happened yet — completing it would let
    // staff collect a balance and issue an invoice for a service not yet
    // rendered. Mirrors the same "already started" requirement as
    // markAppointmentNoShow.
    if (appointment.startTime > new Date()) {
      return { success: false, message: "Ce rendez-vous n'a pas encore eu lieu — impossible de le marquer comme terminé." };
    }

    // The ids come from the browser, so every one is re-read here against
    // the only prestations this appointment may cover: same visit, same staff
    // member, same client, confirmed, already started, and with no money
    // recorded anywhere yet.
    const coverIds = Array.isArray(coverAppointmentIds)
      ? [...new Set(coverAppointmentIds)].filter((id) => typeof id === "string" && id && id !== appointmentId)
      : [];
    let covered = [];
    if (coverIds.length > 0) {
      if (appointment.payment || !appointment.visitId) {
        return { success: false, message: VISIT_COVER_CHANGED_MESSAGE };
      }
      if (finalTotal !== undefined && finalTotal !== null) {
        return { success: false, message: "Un ajustement de prix se fait prestation par prestation, pas sur toute la visite." };
      }
      if (isCounterQr(method)) {
        return { success: false, message: "Le paiement par QR se fait prestation par prestation, pas sur toute la visite." };
      }
      covered = await prisma.appointment.findMany({
        where: {
          id: { in: coverIds },
          visitId: appointment.visitId,
          staffId: appointment.staffId,
          userId: appointment.userId,
          status: "CONFIRMED",
          isDeleted: false,
          startTime: { lte: new Date() },
          coveredByPaymentId: null,
          payment: { is: null },
        },
        orderBy: { startTime: "asc" },
        select: { id: true, staffService: { select: { price: true, service: { select: { name: true } } } } },
      });
      if (covered.length !== coverIds.length) {
        return { success: false, message: VISIT_COVER_CHANGED_MESSAGE };
      }
    }
    const coveredIds = covered.map((c) => c.id);
    // What the ticket and the invoice call this sale: every prestation it settles.
    const serviceItems = [appointment, ...covered].map((a) => ({
      description: a.staffService?.service?.name ?? "Prestation",
      amount: Number(a.staffService?.price ?? 0),
    }));
    const serviceDescription = serviceItems.map((item) => item.description).join(" + ");

    const payment = appointment.payment;
    const onSitePrice =
      Number(appointment.staffService?.price ?? 0) +
      covered.reduce((sum, c) => sum + Number(c.staffService?.price ?? 0), 0);
    const priceAdjustment = resolveCounterPriceAdjustment({
      baseTotal: Number(payment?.totalAmount ?? onSitePrice),
      paidAmount: Number(payment?.paidAmount ?? 0),
      finalTotal,
      reason: adjustmentReason,
    });
    if (!priceAdjustment.success) return priceAdjustment;

    const hasBalanceDue = Boolean(payment) && priceAdjustment.amountDue > 0 && (
      payment.status === "PARTIALLY_PAID" ||
      (payment.status === "PENDING" && payment.paymentType === "ON_SITE") ||
      (payment.status === "PAID" && priceAdjustment.changed)
    );

    // An appointment booked "payer au salon", taken in MANUAL confirmation
    // mode, or created by staff carries no Payment row at all —
    // shouldCreatePaymentRecord (lib/reservation-payment.js) is only true when
    // money is taken online at booking time. Completing one used to write
    // nothing but a status: no transaction, no cash-book line, no invoice,
    // and therefore no row in Opérations. The service had happened and the
    // money was recorded nowhere at all, which also kept it out of the till
    // total and the Z-closure.
    //
    // The price is StaffService.price — the same figure the booking quoted
    // (see create-reservation.js: rawTotalAmount). A zero-priced service
    // collects nothing and still completes in one click.
    const collectsOnSite = !payment && priceAdjustment.amountDue > 0;

    // Both paths hand money across a counter, so both need the same
    // attestations: the system can no more observe cash here than it can when
    // settling a balance.
    const collectsMoney = hasBalanceDue || collectsOnSite;

    // Only Marie and OWNER/ADMIN put cash into the Livre de caisse. Anyone
    // else still completes the rendez-vous and still records the money, but
    // off-till: no method choice, no attestation, no open-till requirement,
    // and the collection Transaction is detached from every cash session so
    // it shows in Opérations but not in the drawer's book or its X/Z report.
    // AppointmentDrawer / FicheSettleAction hide the popup for them too.
    // An independent practitioner's appointment is her sale: off-till whoever
    // collects it — even the admin or Marie — with no salon ticket or invoice.
    // With no Payment row yet, the practitioner it is booked with decides.
    const independentSale = payment
      ? Boolean(payment.payeeStaffId)
      : Boolean((await resolvePayeeForAppointment(prisma, { staffId: appointment.staffId })).payeeStaffId);
    // The salon's sale enters the till when the collector may run it
    // (canUseSalonTill: Marie, the admins, a CAISSE staff member).
    const offTill = independentSale || !(await canUseSalonTill(authCheck.user));
    const collectsAtTill = collectsMoney && !offTill;

    // A card payment is only accepted as EXTERNAL_TERMINAL, which carries the
    // terminal's approval and its receipt reference. Plain "CARD" used to be
    // accepted with no evidence at all: of 29 card collections in the dev
    // database, exactly one had a reference, so 28 could not be reconciled
    // against the terminal's end-of-day batch. Cash is at least tied to a
    // piece number and an open till session; a bare card row was tied to
    // nothing. The boutique POS (lib/validations/point-of-sale.js) and the
    // refund path (validateManualRefundConfirmation) already required this —
    // settlement was the one place that did not.
    // TRANSFER is not a collection: the client leaves without paying and the
    // money is only recorded when an admin accepts the transfer — see
    // lib/payments/awaited-transfer.js. So no attestation, no till session
    // and no invoice here; only the amount expected is written down.
    const awaitsTransfer = collectsAtTill && isAwaitedTransfer(method);
    // Off-till (a non-operator, or an independent's appointment): refuse
    // rather than fall into the collection branch below, which would record
    // the visit as paid although nothing was received.
    if (collectsMoney && !collectsAtTill && isAwaitedTransfer(method)) {
      return { success: false, message: AWAITED_TRANSFER_OFF_TILL_MESSAGE };
    }
    // « Carte QR »: Stripe is the attestation, asked before anything is
    // recorded — for this appointment and this exact amount.
    const paidByQr = collectsAtTill && isCounterQr(method);
    let qrPayment = null;
    if (paidByQr) {
      qrPayment = await verifyCounterQrPayment(qrSessionId, {
        surface: COUNTER_QR_SURFACES.APPOINTMENT,
        targetId: appointmentId,
        amount: priceAdjustment.amountDue,
      });
      if (!qrPayment.paid) {
        return { success: false, message: COUNTER_QR_MESSAGES[qrPayment.reason] ?? "Paiement par QR non confirmé." };
      }
    }
    if (collectsAtTill && !["CASH", "EXTERNAL_TERMINAL", AWAITED_TRANSFER_METHOD, COUNTER_QR_METHOD].includes(method)) {
      return {
        success: false,
        message: hasBalanceDue
          ? "Mode de paiement requis pour encaisser le solde restant."
          : "Mode de paiement requis pour encaisser ce rendez-vous.",
        requiresPaymentConfirmation: true,
      };
    }
    // No typed terminal reference any more — see lib/payments/terminal-reference.js.
    if (collectsAtTill && method === "EXTERNAL_TERMINAL" && terminalApproved !== true) {
      return { success: false, message: "Confirmez le paiement approuvé sur le terminal.", requiresPaymentConfirmation: true };
    }
    // The system has no way to observe a physical cash handoff or a card
    // terminal's "APPROUVÉ" screen — without this, staff could mark the
    // balance paid (and the system would treat it as real, invoiceable
    // revenue) before any money actually changed hands, exactly like the
    // POS terminal-sale risk this mirrors. See docs/PRODUCTION_ISSUES.md #2.
    // Only asked of a till operator — an off-till collection never enters the
    // drawer total, so there is nothing to reconcile it against.
    if (collectsAtTill && !awaitsTransfer && !paidByQr && paymentConfirmed !== true) {
      return { success: false, message: "Confirmez avoir bien reçu le paiement avant de terminer le rendez-vous.", requiresPaymentConfirmation: true };
    }
    // Cash with no till open used to be accepted and left unassigned
    // (cashSessionId: null), which is invisible from every Livre de caisse
    // forever — Transaction.pieceNumber is written once and never
    // backfilled. Fast-path check before the transaction; the authoritative
    // one is inside it, in case a session closes in the gap between the two.
    if (collectsAtTill && method === "CASH") {
      const openCashSessionGate = await ensureCashSessionOpen(prisma);
      if (!openCashSessionGate) {
        return {
          success: false,
          message: "Aucune session de caisse n'est ouverte. Ouvrez la caisse avant d'encaisser en espèces.",
          requiresCashSession: true,
        };
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Atomic claim, gated on the appointment still being CONFIRMED —
      // without this, two concurrent completions (double-click, or two
      // staff members racing) both pass the plain read-then-check above and
      // both collect the balance, creating duplicate FINAL_PAYMENT
      // transaction rows (and racing on the invoice's unique paymentId,
      // which turns the loser's request into a confusing generic error
      // instead of a clean "already completed").
      const claim = await tx.appointment.updateMany({
        where: { id: appointmentId, status: "CONFIRMED" },
        data: { status: "COMPLETED" },
      });
      if (claim.count === 0) {
        return { claimed: false };
      }

      // Same atomic claim for the prestations cashed with this one. Losing
      // any of them (completed, cancelled or moved in the meantime) rolls the
      // whole thing back rather than cashing a total that no longer holds.
      if (coveredIds.length > 0) {
        const coveredClaim = await tx.appointment.updateMany({
          where: { id: { in: coveredIds }, status: "CONFIRMED", coveredByPaymentId: null },
          data: { status: "COMPLETED" },
        });
        if (coveredClaim.count !== coveredIds.length) throw new Error("VISIT_COVER_CHANGED");
      }

      let invoice = null;
      // Set only when a counter adjustment forced an existing invoice to be
      // credited and reissued — see resolveSettlementInvoice.
      let creditNote = null;
      let balance = 0;
      let collection = null;
      let updatedPayment = payment;

      if (priceAdjustment.changed && payment && !collectsMoney) {
        updatedPayment = await tx.payment.update({
          where: { id: payment.id },
          data: {
            totalAmount: priceAdjustment.finalTotal,
            remainingAmount: priceAdjustment.amountDue,
            status: priceAdjustment.amountDue > 0 ? "PARTIALLY_PAID" : "PAID",
          },
        });
        if (updatedPayment.status === "PAID") {
          await allocatePaymentTicketNumber(tx, updatedPayment.id, "APPOINTMENT", null, new Date(), offTill);
        }
      }

      // The client leaves without paying: the appointment is completed, the
      // balance stays due and the transfer is expected. No Transaction, no
      // ticket, no invoice until it is accepted.
      if (collectsMoney && awaitsTransfer) {
        updatedPayment = payment
          ? await markPaymentAwaitingTransfer(tx, {
              paymentId: payment.id,
              amount: priceAdjustment.amountDue,
              totalAmount: priceAdjustment.finalTotal,
            })
          : await tx.payment.create({
              data: {
                appointmentId,
                ...payeePaymentData(await resolvePayeeForAppointment(tx, { staffId: appointment.staffId })),
                depositAmount: 0,
                totalAmount: priceAdjustment.finalTotal,
                paidAmount: 0,
                remainingAmount: priceAdjustment.amountDue,
                awaitedTransferAmount: priceAdjustment.amountDue,
                paymentType: "ON_SITE",
                status: "PENDING",
              },
            });
        balance = priceAdjustment.amountDue;
      } else if (collectsMoney) {
        balance = priceAdjustment.amountDue;

        // Payment.appointmentId is @unique, so if the customer's own online
        // payment lands between the read above and this write, the create
        // throws P2002 and the whole completion rolls back — rather than
        // recording the same service as collected twice.
        updatedPayment = payment
          ? await tx.payment.update({
              where: { id: payment.id },
              data: {
                totalAmount: priceAdjustment.finalTotal,
                paidAmount: priceAdjustment.finalTotal,
                remainingAmount: 0,
                status: "PAID",
              },
            })
          : await tx.payment.create({
              data: {
                appointmentId,
                ...payeePaymentData(await resolvePayeeForAppointment(tx, { staffId: appointment.staffId })),
                depositAmount: 0,
                totalAmount: priceAdjustment.finalTotal,
                paidAmount: priceAdjustment.finalTotal,
                remainingAmount: 0,
                paymentType: "ON_SITE",
                status: "PAID",
                paidAt: new Date(),
              },
            });

        // Attach to whichever till session is open so the counter cash is
        // reconcilable at close (see lib/cash-sessions.js). Authoritative
        // check — the fast-path gate above already refused this request once
        // if no session was open, but a session can close in the gap between
        // that read and this write; re-checked here so the answer is never
        // stale by the time the row is actually created. Only a till
        // operator's CASH collection joins the drawer book; an off-till
        // collection is deliberately detached (no session, no piece number).
        const useTill = !offTill && method === "CASH";
        const isTerminalCard = !offTill && method === "EXTERNAL_TERMINAL";
        // A QR charge lives on Stripe, never in the drawer.
        const isQr = !offTill && isCounterQr(method);
        const openCashSession = useTill
          ? await tx.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } })
          : null;
        if (useTill && !openCashSession) throw new Error("APPOINTMENT_CASH_SESSION_CLOSED");
        // Cash-book line number, allocated only for the CASH rows that
        // actually enter the till total — see model Transaction.pieceNumber.
        const pieceNumber = useTill ? await allocatePieceNumber(tx, PIECE_SERIES.APPOINTMENT) : null;

        // « Prestation n°12 » — see lib/payments/terminal-reference.js.
        const terminalReference = isTerminalCard ? await allocateBookingTerminalReference(tx, "APPOINTMENT") : null;

        collection = await tx.transaction.create({
          data: {
            paymentId: updatedPayment.id,
            amount: balance,
            // A card terminal collection records as CARD; a cash handover —
            // whether it joins the till or is taken off-till — records as CASH.
            method: isQr ? "ONLINE" : isTerminalCard ? "CARD" : "CASH",
            transactionType: "FINAL_PAYMENT",
            paidAt: new Date(),
            cashSessionId: useTill ? openCashSession.id : null,
            pieceNumber,
            manualReference: isTerminalCard ? terminalReference : isQr ? qrPayment.paymentIntentId : null,
          },
        });

        await allocatePaymentTicketNumber(tx, updatedPayment.id, "APPOINTMENT", null, new Date(), offTill);

        // Same rule everywhere: a particulier never gets an invoice, only a
        // VIES-valid VAT identity does (see settleReservation). A
        // non-privileged staff member (offTill) can never cause an Invoice
        // to be created — see canUseSalonTill — resolveSettlementInvoice
        // is a hard no-op for them: nothing invoice-related is touched, not
        // even superseding an existing one.
        const completionVatPolicy = resolveServiceVatPolicy({ customer: appointment.user });
        ({ invoice, creditNote } = await resolveSettlementInvoice(tx, {
          existingInvoice: payment?.invoice ?? null,
          priceChanged: priceAdjustment.changed,
          adjustmentReason: priceAdjustment.reason,
          shouldIssue: hasInvoiceableVatIdentity(appointment.user),
          canIssue: !offTill,
          issue: (supersedesInvoiceId) =>
            issueInvoice(tx, {
              paymentId: updatedPayment.id,
              source: "APPOINTMENT",
              totalInclVat: Number(updatedPayment.totalAmount),
              customer: buildInvoiceCustomer(appointment.user),
              lines: buildServiceInvoiceLines({
                description: serviceDescription,
                items: serviceItems,
                totalAmount: Number(updatedPayment.totalAmount),
                discountAmount: Number(updatedPayment.discountAmount),
                // Signed, and only when the counter actually moved the price —
                // otherwise the document reconstructs a price that was never
                // quoted (worst on a booking that also carried a promo code).
                adjustmentAmount: priceAdjustment.changed
                  ? priceAdjustment.finalTotal - priceAdjustment.previousTotal
                  : 0,
                adjustmentReason: priceAdjustment.reason,
              }),
              vatRate: completionVatPolicy.vatRate,
              vatTreatment: completionVatPolicy.vatTreatment,
              taxCountryCode: completionVatPolicy.taxCountryCode,
              taxNote: completionVatPolicy.taxNote,
              supersedesInvoiceId,
            }),
        }));
      }

      // The write-off case: the adjustment closed the balance to zero, so no
      // money changed hands and the block above never ran. An invoice already
      // on file still has to be corrected — it states a total the Payment no
      // longer carries.
      if (priceAdjustment.changed && !collectsMoney && updatedPayment) {
        const completionVatPolicy = resolveServiceVatPolicy({ customer: appointment.user });
        ({ invoice, creditNote } = await resolveSettlementInvoice(tx, {
          existingInvoice: payment?.invoice ?? null,
          priceChanged: true,
          adjustmentReason: priceAdjustment.reason,
          shouldIssue: hasInvoiceableVatIdentity(appointment.user),
          canIssue: !offTill,
          issue: (supersedesInvoiceId) =>
            issueInvoice(tx, {
              paymentId: updatedPayment.id,
              source: "APPOINTMENT",
              totalInclVat: Number(updatedPayment.totalAmount),
              customer: buildInvoiceCustomer(appointment.user),
              lines: buildServiceInvoiceLines({
                description: serviceDescription,
                items: serviceItems,
                totalAmount: Number(updatedPayment.totalAmount),
                discountAmount: Number(updatedPayment.discountAmount ?? 0),
                adjustmentAmount: supersedesInvoiceId
                  ? priceAdjustment.finalTotal - priceAdjustment.previousTotal
                  : 0,
                adjustmentReason: priceAdjustment.reason,
              }),
              vatRate: completionVatPolicy.vatRate,
              vatTreatment: completionVatPolicy.vatTreatment,
              taxCountryCode: completionVatPolicy.taxCountryCode,
              taxNote: completionVatPolicy.taxNote,
              supersedesInvoiceId,
            }),
        }));
      }

      if (priceAdjustment.changed) {
        await tx.auditLog.create({
          data: {
            actorId: authCheck.userId,
            actorRole: authCheck.userRole,
            action: AUDIT_ACTIONS.RESERVATION_PRICE_ADJUSTED,
            entityType: "Appointment",
            entityId: appointmentId,
            before: { totalAmount: priceAdjustment.previousTotal },
            after: { totalAmount: priceAdjustment.finalTotal },
            metadata: {
              reason: priceAdjustment.reason,
              paidAmountBeforeAdjustment: priceAdjustment.paidAmount,
            },
          },
        });
      }

      // The money of the covered prestations is on this appointment's
      // Payment. Nothing to point at when the whole lot was free.
      if (coveredIds.length > 0 && updatedPayment) {
        await tx.appointment.updateMany({
          where: { id: { in: coveredIds } },
          data: { coveredByPaymentId: updatedPayment.id },
        });
      }

      return { claimed: true, invoice, creditNote, balance, collection };
    });

    if (!result.claimed) {
      return { success: false, message: "Ce rendez-vous vient de changer d'état. Actualisez la page." };
    }
    const { balance } = result;

    // Who collected decides what the client receives: the salon (admin or
    // Marie) sends the ticket; an independent's sale has no salon ticket, so
    // the client gets a ticket-free payment confirmation instead — see
    // lib/payments/send-settlement-email.js. Fire-and-forget
    // (never awaited, only .catch()-guarded) so a ticket failure can never
    // turn a successful settlement into an error response — same as the
    // legally-required Invoice, issued above inside the transaction, which
    // is never auto-sent either (Marie sends it manually from Opérations).
    // An awaited transfer collected nothing, so there is no ticket to send
    // yet — accepting it later does that (actions/payments/awaited-transfer.js).
    if (balance > 0 && result.collection) {
      sendSettlementEmail(authCheck.user, result.collection.paymentId, { transactionId: result.collection.id }).catch((err) =>
        console.error("[completeAppointment] ticket send failed", err),
      );
    }

    // The cash-book UI needs a refresh only for a CASH collection that
    // actually entered the till — an off-till collection never touches the
    // Livre de caisse.
    if (balance > 0 && !offTill && method === "CASH") revalidateCaisseRoutes();

    revalidatePath("/dashboard/operations");
    return {
      success: true,
      message: awaitsTransfer
        ? `Rendez-vous terminé — virement de ${priceAdjustment.amountDue.toFixed(2)} € attendu. Acceptez-le dans « Ventes en attente de paiement » à sa réception.`
        : collectsOnSite
        ? offTill
          ? "Rendez-vous terminé — paiement enregistré."
          : "Rendez-vous terminé — paiement encaissé et enregistré."
        : hasBalanceDue
          ? offTill
            ? "Rendez-vous terminé — solde enregistré et facturé."
            : "Rendez-vous terminé — solde encaissé et facturé."
          : "Rendez-vous marqué comme terminé.",
    };
  } catch (error) {
    if (error.message === "SELLER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: "Identité légale du salon incomplète — complétez Réglages > Salon avant d'émettre des factures." };
    }
    if (error.message === "BUYER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: error.userMessage };
    }
    if (error.message === "APPOINTMENT_CASH_SESSION_CLOSED") {
      return {
        success: false,
        message: "La session de caisse vient d'être clôturée. Ouvrez-la à nouveau avant d'encaisser.",
        requiresCashSession: true,
      };
    }
    if (error.message === "INVOICE_REPLACEMENT_VAT_EXPIRED") {
      return {
        success: false,
        message:
          "Le numéro de TVA de ce client n'est plus valide : sa facture ne peut pas être réémise au nouveau prix. Revalidez-le sur sa fiche, puis réessayez.",
      };
    }
    if (error.message === "VISIT_COVER_CHANGED") {
      return { success: false, message: VISIT_COVER_CHANGED_MESSAGE };
    }
    console.error("[completeAppointment]", error);
    return { success: false, message: "Erreur lors de la finalisation du rendez-vous." };
  }
}

const VISIT_COVER_CHANGED_MESSAGE =
  "Une prestation de cette visite vient de changer d'état. Actualisez la page, puis réessayez.";

/**
 * « Terminer toute la visite »: closes every prestation of the appointment's
 * visit that is confirmed and has already started, and cashes them in as few
 * operations as the money allows — ONE PER STAFF MEMBER.
 *
 * Per staff member, not per visit, because that is where the money stops
 * being one thing: an independent's prestation is her own sale, under her
 * own VAT number (lib/payments/resolve-payee.js), and even between two
 * employees the takings are counted per practitioner (her contract's
 * commission, the dashboard's per-staff revenue). So one staff member doing
 * two prestations is a single operation and a single ticket; two staff
 * members are two.
 *
 * Within one staff member, the prestations with no money recorded yet are
 * cashed together on one Payment (completeAppointment's coverAppointmentIds).
 * A prestation that already has its own Payment — an acompte taken online —
 * settles its own balance, as it always did.
 *
 * A prestation that has not started yet is left alone, exactly like
 * « Terminer » on a single rendez-vous: nothing is cashed before it happens.
 *
 * Closed by the salon (an admin), a visit never includes an independent's
 * prestation: that sale is hers and stays out of the salon's hands and books.
 * Closed by a staff member, it only ever includes her own prestations.
 *
 * The same payment method and the same « j'ai bien reçu » attestation apply
 * to the whole visit: the client pays once at the counter. Only cash and the
 * card terminal are offered — a transfer, a QR charge or a price adjustment
 * is about one exact amount and stays a per-prestation action.
 *
 * Each staff member's part is its own database transaction. If a later part
 * fails after an earlier one succeeded, the answer says how far it got; what
 * is closed stays closed and « Terminer » can simply be pressed again.
 *
 * @param {string} appointmentId - any prestation of the visit
 * @param {{ method?: "CASH" | "EXTERNAL_TERMINAL", paymentConfirmed?: boolean, terminalApproved?: boolean }} [options]
 */
export async function completeVisit(appointmentId, { method, paymentConfirmed, terminalApproved } = {}) {
  try {
    if (!appointmentId) {
      return { success: false, message: "ID de rendez-vous manquant" };
    }

    const authCheck = await authorizeAppointmentAction(appointmentId);
    if (!authCheck.authorized) {
      return { success: false, message: authCheck.message };
    }

    const options = { method, paymentConfirmed, terminalApproved };
    const anchor = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      select: { id: true, visitId: true, staffId: true },
    });
    // Not part of a visit: this is plain « Terminer ».
    if (!anchor?.visitId) return completeAppointment(appointmentId, options);

    if (method && !["CASH", "EXTERNAL_TERMINAL"].includes(method)) {
      return {
        success: false,
        message:
          "Une visite entière s'encaisse en espèces ou par carte sur le terminal. Pour un autre mode de paiement, terminez les prestations une par une.",
      };
    }

    // A staff member closes her own prestations of the visit, never a colleague's.
    const ownStaffId = isAdminRole(authCheck.userRole) ? null : await getCurrentStaffId();
    const legs = await prisma.appointment.findMany({
      where: {
        visitId: anchor.visitId,
        isDeleted: false,
        status: "CONFIRMED",
        startTime: { lte: new Date() },
        ...(ownStaffId ? { staffId: ownStaffId } : {}),
      },
      orderBy: { startTime: "asc" },
      select: { id: true, staffId: true, payment: { select: { id: true } } },
    });
    // The salon closes and cashes the salon's prestations only. An
    // independent's prestation is her own sale (lib/payments/resolve-payee.js):
    // it is never swept into a visit the salon is closing — she closes it
    // herself, from her own dashboard, and its money never crosses the
    // salon's counter as part of someone else's total.
    let salonLegs = legs;
    if (!ownStaffId) {
      const independentStaffIds = new Set();
      for (const staffId of new Set(legs.map((leg) => leg.staffId))) {
        const payee = await resolvePayeeForAppointment(prisma, { staffId });
        if (payee.payeeStaffId) independentStaffIds.add(staffId);
      }
      salonLegs = legs.filter((leg) => !independentStaffIds.has(leg.staffId));
    }

    // The prestation the button was pressed on is not part of that (already
    // closed, not started, or an independent's own): plain « Terminer », and
    // completeAppointment applies its own rules to it.
    if (!salonLegs.some((leg) => leg.id === appointmentId)) return completeAppointment(appointmentId, options);

    // The pressed prestation's staff member first, so a refusal that needs
    // the form again (payment not confirmed, till closed) comes before
    // anything is written.
    const staffIds = [anchor.staffId, ...new Set(salonLegs.map((leg) => leg.staffId).filter((id) => id !== anchor.staffId))];

    let closed = 0;
    let lastResult = null;
    for (const staffId of staffIds) {
      const own = salonLegs.filter((leg) => leg.staffId === staffId);
      const unpaid = own.filter((leg) => !leg.payment);
      const calls = [];
      if (unpaid.length > 0) {
        const lead = unpaid.find((leg) => leg.id === appointmentId) ?? unpaid[0];
        calls.push({
          id: lead.id,
          count: unpaid.length,
          options: { ...options, coverAppointmentIds: unpaid.filter((leg) => leg.id !== lead.id).map((leg) => leg.id) },
        });
      }
      for (const leg of own.filter((l) => l.payment)) calls.push({ id: leg.id, count: 1, options });

      for (const call of calls) {
        const result = await completeAppointment(call.id, call.options);
        if (!result.success) {
          if (closed === 0) return result;
          revalidatePath("/dashboard/operations");
          return {
            success: false,
            partial: true,
            message: `${closed} prestation${closed > 1 ? "s" : ""} de la visite ${closed > 1 ? "sont terminées" : "est terminée"}, mais la suite a échoué : ${result.message}`,
          };
        }
        closed += call.count;
        lastResult = result;
      }
    }

    return closed > 1
      ? { success: true, message: `Visite terminée — ${closed} prestations clôturées.` }
      : lastResult;
  } catch (error) {
    console.error("[completeVisit]", error);
    return { success: false, message: "Erreur lors de la finalisation de la visite." };
  }
}

/**
 * Gets an appointment by ID with all related data.
 * Used by the payment page.
 *
 * Returns full customer PII (email, phone) and payment details, so this must
 * never be reachable by anyone but the appointment's own owner or a
 * dashboard role — appointment ids are cuids that show up in URLs and
 * emails, not secrets.
 *
 * @param {string} appointmentId
 * @returns {Promise<{ success: boolean, appointment?: any, message?: string }>}
 */
export async function getAppointmentById(appointmentId) {
  try {
    if (!appointmentId) {
      return { success: false, message: "ID de rendez-vous manquant" };
    }

    const session = await auth();
    if (!session?.user) {
      return { success: false, message: "Authentification requise" };
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
        staffService: {
          include: {
            service: true,
            staff: {
              include: {
                user: {
                  select: { fullName: true },
                },
              },
            },
          },
        },
        payment: true,
      },
    });

    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable" };
    }

    const isOwner = appointment.userId === session.user.id;
    let isAssignedStaff = false;
    if (!isOwner && session.user.role === ROLES.STAFF) {
      const hasAppointmentAccess = await hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS);
      if (hasAppointmentAccess) {
        const staffId = await getCurrentStaffId();
        isAssignedStaff = !!staffId && appointment.staffService.staffId === staffId;
      }
    }
    if (!isOwner && !isAdminRole(session.user.role) && !isAssignedStaff) {
      // Same message as "not found" — don't confirm an id belongs to someone else.
      return { success: false, message: "Rendez-vous introuvable" };
    }

    return {
      success: true,
      appointment,
    };
  } catch (error) {
    console.error("[getAppointmentById]", error);
    return {
      success: false,
      message: "Erreur lors de la récupération du rendez-vous",
    };
  }
}

/**
 * Permanently removes (soft-deletes) an appointment from the system.
 *
 * For CANCELLED appointments, the associated Payment record (if any) is also
 * soft-deleted in the same transaction — a cancelled booking's financial trail
 * is no longer operationally needed.
 *
 * For all other statuses, if a Payment record exists, deletion is refused to
 * preserve financial integrity for active/completed bookings.
 *
 * The appointment is soft-deleted (isDeleted=true) rather than hard-deleted
 * so that any orphaned references (notifications, cancellation requests)
 * don't break. The row becomes invisible in all queries.
 *
 * @param {string} appointmentId
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export async function deleteAppointment(appointmentId) {
  try {
    if (!appointmentId) {
      return { success: false, message: "ID de rendez-vous manquant" };
    }

    const authCheck = await authorizeAppointmentAction(appointmentId);
    if (!authCheck.authorized) {
      return { success: false, message: authCheck.message };
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      select: {
        id: true,
        status: true,
        payment: { select: { id: true } },
      },
    });

    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable" };
    }

    const hasPayment = Boolean(appointment.payment);
    const isCancelled = appointment.status === "CANCELLED";

    // Non-cancelled appointments with a payment must not be deleted —
    // financial records must be preserved for active/completed bookings.
    if (hasPayment && !isCancelled) {
      return {
        success: false,
        message: "Ce rendez-vous est lié à un paiement et ne peut pas être supprimé. Utilisez l'annulation plutôt que la suppression.",
      };
    }

    // Cancelled appointments: soft-delete both the appointment and its
    // payment (if any) in a single transaction for consistency.
    if (hasPayment && isCancelled) {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: appointment.payment.id },
          data: { isDeleted: true, deletedAt: new Date() },
        });
        await tx.appointment.update({
          where: { id: appointmentId },
          data: { isDeleted: true, deletedAt: new Date() },
        });
      });
    } else {
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { isDeleted: true, deletedAt: new Date() },
      });
    }

    revalidatePath("/dashboard/appointments");
    revalidatePath("/dashboard/calendrier");

    return { success: true, message: "Rendez-vous supprimé avec succès." };
  } catch (error) {
    console.error("[deleteAppointment]", error);
    return {
      success: false,
      message: "Erreur lors de la suppression du rendez-vous.",
    };
  }
}
