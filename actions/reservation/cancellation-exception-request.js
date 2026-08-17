"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { isWithinCancellationWindow } from "@/lib/reservationRules";
import { sendEmail } from "@/lib/email";
import { rejectAppointment } from "@/actions/appointment/manage-appointment";

const requestSchema = z.object({
  appointmentId: z.string().min(1),
  reason: z.string().trim().min(10, "Expliquez brièvement votre situation.").max(1000),
});

const reviewSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  decisionNote: z.string().trim().max(1000).optional().nullable(),
});

function refreshAppointmentViews() {
  revalidatePath("/mes-reservations");
  revalidatePath("/appointments");
  revalidatePath("/dashboard/appointments");
  revalidatePath("/dashboard/appointments/exceptions");
}

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { error: "Seul un administrateur peut traiter ces demandes." };
  }
  return { session };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function notifyAdminsOfRequest(request, appointment) {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN"] }, isActive: true, isDeleted: false },
    select: { id: true, email: true, fullName: true },
  });
  if (!admins.length) return;

  await prisma.notification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      appointmentId: appointment.id,
      type: "APPOINTMENT_CANCELLATION_REQUEST",
      title: "Demande d'annulation exceptionnelle",
      message: `${appointment.user.fullName} demande l'examen d'une annulation exceptionnelle pour son rendez-vous du ${appointment.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })}.`,
      status: "PENDING",
      actionUrl: "/dashboard/appointments/exceptions",
    })),
  });

  await Promise.allSettled(
    admins.map((admin) =>
      sendEmail({
        to: admin.email,
        subject: "Demande d'annulation exceptionnelle — Meri Beauty",
        text: `Bonjour ${admin.fullName},\n\n${appointment.user.fullName} a soumis une demande d'annulation exceptionnelle pour son rendez-vous du ${appointment.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })}.\n\nMotif : ${request.reason}\n\nOuvrez le tableau de bord pour l'accepter ou la refuser.`,
        html: `<p>Bonjour ${escapeHtml(admin.fullName)},</p><p><strong>${escapeHtml(appointment.user.fullName)}</strong> a soumis une demande d'annulation exceptionnelle pour son rendez-vous du ${appointment.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })}.</p><p><strong>Motif :</strong> ${escapeHtml(request.reason)}</p><p>Ouvrez le tableau de bord pour l'accepter ou la refuser.</p>`,
      })
    )
  );
}

/** Customer-only. This does not cancel the appointment and cannot refund money. */
export async function submitCancellationExceptionRequest(input) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: parsed.error.issues[0]?.message ?? "Demande invalide." };

  const session = await auth();
  if (!session?.user?.id) return { success: false, message: "Authentification requise." };
  if (session.user.role !== "CUSTOMER") {
    return { success: false, message: "Seul le client peut envoyer cette demande depuis son espace." };
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: parsed.data.appointmentId, isDeleted: false },
    include: { user: { select: { fullName: true, email: true } } },
  });
  if (!appointment || appointment.userId !== session.user.id) {
    return { success: false, message: "Rendez-vous introuvable." };
  }
  if (!["PENDING", "ACCEPTED", "CONFIRMED"].includes(appointment.status)) {
    return { success: false, message: "Ce rendez-vous ne peut plus faire l'objet d'une demande." };
  }
  if (!isWithinCancellationWindow(appointment.startTime)) {
    return { success: false, message: "Ce rendez-vous peut encore être annulé directement depuis votre espace." };
  }

  try {
    const request = await prisma.appointmentCancellationRequest.create({
      data: {
        appointmentId: appointment.id,
        requestedByUserId: session.user.id,
        reason: parsed.data.reason,
      },
    });
    await notifyAdminsOfRequest(request, appointment).catch((error) =>
      console.error("[submitCancellationExceptionRequest] notification", error)
    );
    refreshAppointmentViews();
    return { success: true, message: "Votre demande a été transmise à l'équipe. Votre rendez-vous et votre acompte restent inchangés jusqu'à sa décision." };
  } catch (error) {
    if (error?.code === "P2002") {
      return { success: false, message: "Une demande est déjà enregistrée pour ce rendez-vous. L'équipe vous répondra dès que possible." };
    }
    console.error("[submitCancellationExceptionRequest]", error);
    return { success: false, message: "Impossible d'envoyer votre demande. Réessayez ou contactez le salon." };
  }
}

export async function getCancellationExceptionRequests() {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  const rows = await prisma.appointmentCancellationRequest.findMany({
    include: {
      requestedBy: { select: { fullName: true, email: true, phone: true } },
      reviewedBy: { select: { fullName: true } },
      appointment: {
        include: {
          staffService: { include: { service: { select: { name: true } }, staff: { include: { user: { select: { fullName: true } } } } } },
          payment: { select: { paidAmount: true, paymentType: true, status: true } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  return { success: true, data: JSON.parse(JSON.stringify(rows)) };
}

/** Admin-only. Approval is the sole path from an exception request to a full deposit refund. */
export async function reviewCancellationExceptionRequest(input) {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Décision invalide." };

  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const request = await prisma.appointmentCancellationRequest.findUnique({
    where: { id: parsed.data.requestId },
    include: { appointment: { include: { user: { select: { fullName: true, email: true } } } } },
  });
  if (!request || request.status !== "PENDING") {
    return { success: false, message: "Cette demande a déjà été traitée ou n'existe plus." };
  }

  const decisionNote = parsed.data.decisionNote?.trim() || null;
  if (parsed.data.decision === "REJECTED") {
    const claim = await prisma.appointmentCancellationRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "REJECTED", reviewedAt: new Date(), reviewedByUserId: guard.session.user.id, decisionNote },
    });
    if (!claim.count) return { success: false, message: "Cette demande vient d'être traitée." };

    await sendEmail({
      to: request.appointment.user.email,
      subject: "Décision concernant votre demande — Meri Beauty",
      text: `Bonjour ${request.appointment.user.fullName},\n\nVotre demande d'annulation exceptionnelle n'a pas été acceptée. Votre rendez-vous et votre acompte restent inchangés.${decisionNote ? `\n\nMessage de l'équipe : ${decisionNote}` : ""}\n\nL'équipe Meri Beauty`,
      html: `<p>Bonjour ${escapeHtml(request.appointment.user.fullName)},</p><p>Votre demande d'annulation exceptionnelle n'a pas été acceptée. Votre rendez-vous et votre acompte restent inchangés.</p>${decisionNote ? `<p><strong>Message de l'équipe :</strong> ${escapeHtml(decisionNote)}</p>` : ""}<p>L'équipe Meri Beauty</p>`,
    }).catch((error) => console.error("[reviewCancellationExceptionRequest] rejection email", error));
    refreshAppointmentViews();
    return { success: true, message: "Demande refusée. Le client a été informé." };
  }

  // Claim first so two administrators cannot issue two refunds. If the
  // cancellation cannot be completed, return it to PENDING for another review.
  const claim = await prisma.appointmentCancellationRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: { status: "APPROVED", reviewedAt: new Date(), reviewedByUserId: guard.session.user.id, decisionNote },
  });
  if (!claim.count) return { success: false, message: "Cette demande vient d'être traitée." };

  const result = await rejectAppointment(
    request.appointmentId,
    `Annulation exceptionnelle approuvée par l'administration${decisionNote ? ` : ${decisionNote}` : ""}`,
    { waiveDepositForfeit: true }
  );

  if (!result.success) {
    await prisma.appointmentCancellationRequest.updateMany({
      where: { id: request.id, status: "APPROVED" },
      data: { status: "PENDING", reviewedAt: null, reviewedByUserId: null, decisionNote: null },
    });
    return result;
  }

  refreshAppointmentViews();
  return { success: true, message: "Demande approuvée : le rendez-vous est annulé et l'acompte est remboursé intégralement.", refundFailed: result.refundFailed };
}
