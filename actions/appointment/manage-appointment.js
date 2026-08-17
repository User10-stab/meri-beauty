"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { ROLES, isAdminRole } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";
import { sendEmail } from "@/lib/email";
import { reservationAcceptedWithPaymentLinkEmail } from "@/lib/email-templates";
import { issueCreditNote, issueInvoice, buildInvoiceCustomer, buildServiceInvoiceLines } from "@/lib/invoicing";
import { buildRefundIdempotencyKey, pinPendingRefund, markRefundFailed, clearPendingRefund } from "@/lib/payments/pin-pending-refund";
import { isWithinCancellationWindow } from "@/lib/reservationRules";
import { renderInvoicePdf } from "@/lib/pdf/render";
import {
  createNotificationsBulk,
  buildAppointmentConfirmedNotification,
  buildAppointmentCancelledNotification,
  buildAppointmentNoShowNotification,
  getAppointmentNotificationRecipients,
} from "@/lib/notifications";

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

  const userRole = session.user.role;

  // ADMIN/OWNER can manage any appointment
  if (isAdminRole(userRole)) {
    return { authorized: true, userId: session.user.id, userRole };
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

    return { authorized: true, userId: session.user.id, userRole };
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
export async function confirmAppointment(appointmentId) {
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

    // Generate payment URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://meribeauty.com";
    const paymentUrl = `${appUrl}/appointment/${appointmentId}/payment`;

    // Send confirmation email with payment link
    const totalAmount = Number(appointment.staffService.price);

    sendEmail({
      to: appointment.user.email,
      ...reservationAcceptedWithPaymentLinkEmail({
        customerName: appointment.user.fullName,
        serviceName: appointment.staffService.service.name,
        staffName: appointment.staffService.staff?.user?.fullName || "Expert",
        date: appointment.date,
        time: appointment.startTime.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Brussels",
        }),
        totalAmount,
        paymentUrl,
        allowedPaymentMethods: appointment.staffService.staff?.allowedPaymentMethods ?? "BOTH",
        depositEnabled: Boolean(appointment.staffService.staff?.depositEnabled),
        depositPercentage: Number(appointment.staffService.staff?.depositPercentage ?? 0),
      }),
    }).catch((err) =>
      console.error("[confirmAppointment] email failed:", err)
    );

    return {
      success: true,
      message: "Rendez-vous accepté — le client peut maintenant choisir son paiement.",
    };
  } catch (error) {
    console.error("[confirmAppointment]", error);
    return {
      success: false,
      message: "Erreur lors de la confirmation du rendez-vous",
    };
  }
}

/**
 * Rejects/cancels an appointment.
 * Called by the salon owner/staff from the dashboard.
 *
 * @param {string} appointmentId
 * @param {string} reason - Optional reason for rejection
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export async function rejectAppointment(appointmentId, reason = null, { waiveDepositForfeit = false } = {}) {
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
          },
        },
        staffService: {
          include: {
            service: { select: { name: true } },
            staff: { include: { user: { select: { fullName: true } } } },
          },
        },
        payment: { include: { invoice: true } },
      },
    });

    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable" };
    }

    const payment = appointment.payment;
    const wasPaid = Boolean(payment) && ["PAID", "PARTIALLY_PAID"].includes(payment.status);
    // authorizeAppointmentAction already guarantees STAFF only reach this
    // point for appointments assigned to them.
    const cancelledByAssignedStaff = authCheck.userRole === ROLES.STAFF;

    // Cancelling an unpaid request is routine appointment management (STAFF
    // may do it for their own appointments, per authorizeAppointmentAction
    // above) — but cancelling a paid one triggers a real Stripe refund, which
    // per policy only OWNER/ADMIN may issue.
    if (wasPaid) {
      const session = await auth();
      if (!isAdminRole(session?.user?.role) && !cancelledByAssignedStaff) {
        return {
          success: false,
          message: "Seul un administrateur peut annuler un rendez-vous déjà payé (remboursement requis). Contactez un administrateur.",
        };
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
    // withholds a configurable share of a deposit-type payment. Default
    // depositForfeitPercentage is 0 — today's exact "always fully refunded"
    // behaviour — so this is a no-op until a staff member's percentage is
    // explicitly set above zero. Only applies to deposit payments, not a
    // full/balance payment, and never to a no-show (see markAppointmentNoShow,
    // which withholds everything by design and doesn't go through here).
    let forfeitAmount = 0;
    if (
      wasPaid &&
      appointment.status !== "COMPLETED" &&
      payment.paymentType === "DEPOSIT" &&
      isWithinCancellationWindow(appointment.startTime) &&
      !cancelledByAssignedStaff &&
      !waiveDepositForfeit
    ) {
      const forfeitPercentage = Number(appointment.staffService?.staff?.depositForfeitPercentage ?? 0);
      if (forfeitPercentage > 0) {
        forfeitAmount = Math.round(remaining * (forfeitPercentage / 100) * 100) / 100;
        remaining = Math.round((remaining - forfeitAmount) * 100) / 100;
      }
    }

    const needsRefund = wasPaid && payment.transactionReference && remaining > REFUND_EPSILON;
    const refundIdempotencyKey = needsRefund ? buildRefundIdempotencyKey("appt-reject", payment.id) : null;
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
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledByUserId: authCheck.userId,
          cancellationReason: cancellationReasonWithForfeit,
          cancellationSource: isAdminRole(authCheck.userRole) ? "ADMIN" : "STAFF",
        },
      });
      if (claim.count === 0) return false;

      if (wasPaid && payment.invoice && remaining > REFUND_EPSILON) {
        await issueCreditNote(tx, {
          invoiceId: payment.invoice.id,
          reason: cancellationReasonWithForfeit,
          totalInclVat: remaining,
        });
      }

      // Pinned in the same transaction that commits the cancellation itself
      // — see lib/payments/pin-pending-refund.js's doc comment for why this
      // has to happen before the Stripe call below, not just in its catch.
      if (needsRefund) {
        await pinPendingRefund(tx, payment.id, remaining, refundIdempotencyKey);
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

      return true;
    });

    if (!claimed) {
      return { success: true, message: "Ce rendez-vous est déjà annulé." };
    }

    // Payment.status / the REFUND ledger row are only written once Stripe
    // actually confirms the refund — writing them unconditionally beforehand
    // would tell the customer "refunded" even if the Stripe call below fails.
    // pendingRefundAmount/idempotencyKey were already pinned inside the
    // cancellation transaction above.
    let refundFailed = false;
    if (needsRefund) {
      try {
        const stripeSession = await stripe.checkout.sessions.retrieve(payment.transactionReference);
        if (stripeSession.payment_intent) {
          await stripe.refunds.create(
            { payment_intent: stripeSession.payment_intent, amount: Math.round(remaining * 100) },
            { idempotencyKey: refundIdempotencyKey }
          );
          const fullyRefunded = remaining + REFUND_EPSILON >= Number(payment.paidAmount);
          await prisma.$transaction([
            clearPendingRefund(prisma, payment.id, fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED"),
            prisma.transaction.create({
              data: {
                paymentId: payment.id,
                amount: remaining,
                method: "ONLINE",
                transactionType: "REFUND",
                paidAt: new Date(),
                stripePaymentIntentId: stripeSession.payment_intent,
              },
            }),
          ]);
        }
      } catch (err) {
        // The appointment cancellation and credit note are already
        // committed and stay — surface the refund failure loudly so it can
        // be retried/handled manually, rather than silently swallowing it.
        // pendingRefundAmount/idempotencyKey are left set (not cleared) so
        // the cron retry job (lib/payments/retry-failed-refunds.js) can pick
        // it up even if this email is missed.
        console.error("[rejectAppointment] REFUND FAILED for appointment", appointmentId, err);
        refundFailed = true;
        await markRefundFailed(prisma, payment.id, err);
      }
    }

    const refundNote = wasPaid
      ? refundFailed
        ? " Le remboursement est en cours de traitement par notre équipe — vous serez recontacté(e) si besoin."
        : " Le remboursement apparaîtra sur votre compte sous quelques jours."
      : "";

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

    if (refundFailed) {
      const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { email: true } });
      if (salon?.email) {
        sendEmail({
          to: salon.email,
          subject: `⚠️ Remboursement Stripe échoué – Rendez-vous ${appointment.user.fullName}`,
          text: `Le remboursement Stripe pour le rendez-vous de ${appointment.user.fullName} (${appointment.user.email}) du ${appointment.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} a échoué. Traitement manuel requis dans le dashboard Stripe.`,
          html: `<p>Le remboursement Stripe pour le rendez-vous de ${appointment.user.fullName} (${appointment.user.email}) du ${appointment.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} a échoué. Traitement manuel requis dans le dashboard Stripe.</p>`,
        }).catch((err) => console.error("[rejectAppointment] refund-failure alert email failed:", err));
      }
    }

    return {
      success: true,
      message: wasPaid
        ? refundFailed
          ? "Rendez-vous annulé. Le remboursement n'a pas pu être traité automatiquement — notre équipe s'en occupe."
          : "Rendez-vous annulé — le client sera remboursé."
        : "Rendez-vous annulé",
      refundFailed,
    };
  } catch (error) {
    console.error("[rejectAppointment]", error);
    return {
      success: false,
      message: "Erreur lors de l'annulation du rendez-vous",
    };
  }
}

/**
 * Marks a CONFIRMED appointment as a no-show. Unlike rejectAppointment, this
 * never touches Payment or calls Stripe — whatever was captured (deposit or
 * full payment) stays exactly as captured, no automatic refund in either
 * direction. Before this existed, the only way to close out a missed
 * appointment was "Annuler", which always issues a full refund and treats a
 * no-show identically to a business-initiated cancellation — rewarding the
 * absence instead of recording it.
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
        user: { select: { id: true, fullName: true } },
        staffService: { include: { service: { select: { name: true } } } },
      },
    });
    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable" };
    }

    const markedNote = `Marqué absent le ${new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })}`;

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
 * @param {string} appointmentId
 * @param {{ method?: "CASH" | "CARD" }} [options] - method is required only
 *   when a balance is actually due.
 */
export async function completeAppointment(appointmentId, { method, paymentConfirmed } = {}) {
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
        payment: true,
      },
    });

    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable" };
    }
    if (appointment.status !== "CONFIRMED") {
      return { success: false, message: "Seul un rendez-vous confirmé peut être marqué comme terminé." };
    }

    const payment = appointment.payment;
    const hasBalanceDue = Boolean(payment) && Number(payment.remainingAmount) > 0 && (
      payment.status === "PARTIALLY_PAID" ||
      (payment.status === "PENDING" && payment.paymentType === "ON_SITE")
    );

    if (hasBalanceDue && !["CASH", "CARD"].includes(method)) {
      return { success: false, message: "Mode de paiement requis pour encaisser le solde restant." };
    }
    // The system has no way to observe a physical cash handoff or a card
    // terminal's "APPROUVÉ" screen — without this, staff could mark the
    // balance paid (and the system would treat it as real, invoiceable
    // revenue) before any money actually changed hands, exactly like the
    // POS terminal-sale risk this mirrors. See PRODUCTION_ISSUES.md #2.
    if (hasBalanceDue && paymentConfirmed !== true) {
      return { success: false, message: "Confirmez avoir bien reçu le paiement avant de terminer le rendez-vous.", requiresPaymentConfirmation: true };
    }

    const { invoice, balance } = await prisma.$transaction(async (tx) => {
      let invoice = null;
      let balance = 0;

      if (hasBalanceDue) {
        balance = Number(payment.remainingAmount);

        const updatedPayment = await tx.payment.update({
          where: { id: payment.id },
          data: {
            paidAmount: payment.totalAmount,
            remainingAmount: 0,
            status: "PAID",
          },
        });

        await tx.transaction.create({
          data: {
            paymentId: updatedPayment.id,
            amount: balance,
            method,
            transactionType: "FINAL_PAYMENT",
            paidAt: new Date(),
          },
        });

        invoice = await issueInvoice(tx, {
          paymentId: updatedPayment.id,
          source: "APPOINTMENT",
          totalInclVat: Number(updatedPayment.totalAmount),
          customer: buildInvoiceCustomer(appointment.user),
          lines: buildServiceInvoiceLines({
            description: appointment.staffService.service?.name ?? "Prestation",
            totalAmount: Number(updatedPayment.totalAmount),
            discountAmount: Number(updatedPayment.discountAmount),
          }),
        });
      }

      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: "COMPLETED" },
      });

      return { invoice, balance };
    });

    if (invoice) {
      const invoicePdf = await renderInvoicePdf(invoice).catch((err) => {
        console.error("[completeAppointment] invoice PDF render failed:", err);
        return null;
      });

      sendEmail({
        to: appointment.user.email,
        subject: "Facture — solde réglé – Meri Beauty",
        text:
          `Bonjour ${appointment.user.fullName},\n\n` +
          `Le solde de €${balance.toFixed(2)} pour votre rendez-vous du ${appointment.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} a bien été encaissé. ` +
          `Vous trouverez votre facture en pièce jointe.\n\nL'équipe Meri Beauty`,
        html:
          `<p>Bonjour ${appointment.user.fullName},</p>` +
          `<p>Le solde de €${balance.toFixed(2)} pour votre rendez-vous du ${appointment.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} a bien été encaissé. ` +
          `Vous trouverez votre facture en pièce jointe.</p><p>L'équipe Meri Beauty</p>`,
        ...(invoicePdf ? { attachments: [{ filename: `facture-${invoice.number}.pdf`, content: invoicePdf }] } : {}),
      }).catch((err) => console.error("[completeAppointment] receipt email failed:", err));
    }

    return {
      success: true,
      message: hasBalanceDue ? "Rendez-vous terminé — solde encaissé et facturé." : "Rendez-vous marqué comme terminé.",
    };
  } catch (error) {
    if (error.message === "SELLER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: "Identité légale du salon incomplète — complétez Réglages > Salon avant d'émettre des factures." };
    }
    console.error("[completeAppointment]", error);
    return { success: false, message: "Erreur lors de la finalisation du rendez-vous." };
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
      const staffId = await getCurrentStaffId();
      isAssignedStaff = !!staffId && appointment.staffService.staffId === staffId;
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
