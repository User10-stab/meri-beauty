"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { sendEmail } from "@/lib/email";
import { cancelWorkshopReservation } from "@/actions/workshops/manage-reservation";
import { cancelFormationReservation } from "@/actions/formations/manage-reservation";

/**
 * The atelier/formation counterpart of actions/reservation/cancellation-exception-request.js.
 *
 * Neither flow lets a customer cancel themselves — the 50% deposit is
 * non-refundable and exceptions (medical, bereavement, genuine force
 * majeure) are Marie's call, case by case. Before this the customer saw no
 * cancel button and no explanation, so every such case became an untracked
 * phone call. This gives the request a durable home and a reviewable
 * decision, without granting self-service cancellation.
 *
 * Submitting NEVER cancels anything and NEVER moves money. Only an admin
 * approving does, and it routes through the same cancelWorkshopReservation /
 * cancelFormationReservation actions the dashboard already uses.
 */

const KINDS = {
  WORKSHOP: {
    delegate: (client) => client.workshopReservation,
    idField: "workshopReservationId",
    label: "atelier",
    include: { session: { include: { workshop: { select: { title: true } } } } },
    titleOf: (r) => r.session?.workshop?.title ?? "Atelier",
    cancel: (id, reason) => cancelWorkshopReservation(id, { reason, refundDeposit: true }),
  },
  FORMATION: {
    delegate: (client) => client.formationReservation,
    idField: "formationReservationId",
    label: "formation",
    include: { session: { include: { formation: { select: { title: true } } } } },
    titleOf: (r) => r.session?.formation?.title ?? "Formation",
    cancel: (id, reason) => cancelFormationReservation(id, { reason, refundPayment: true }),
  },
};

const submitSchema = z.object({
  kind: z.enum(["WORKSHOP", "FORMATION"]),
  reservationId: z.string().min(1),
  reason: z.string().trim().min(10, "Expliquez brièvement votre situation.").max(1000),
});

const reviewSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  decisionNote: z.string().trim().max(1000).optional().nullable(),
});

function refreshViews() {
  revalidatePath("/mon-compte");
  revalidatePath("/dashboard/workshops/reservations");
  revalidatePath("/dashboard/formations/reservations");
  revalidatePath("/dashboard/reservations/exceptions");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { error: "Seul un administrateur peut traiter ces demandes." };
  }
  return { session };
}

async function notifyAdmins({ reason, customerName, title, label }) {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN"] }, isActive: true, isDeleted: false },
    select: { id: true, email: true, fullName: true },
  });
  if (!admins.length) return;

  await prisma.notification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      type: "RESERVATION_CANCELLATION_REQUEST",
      title: "Demande d'annulation exceptionnelle",
      message: `${customerName} demande l'annulation de sa réservation « ${title} » (${label}).`,
      status: "PENDING",
      actionUrl: "/dashboard/reservations/exceptions",
    })),
  });

  await Promise.allSettled(
    admins.map((admin) =>
      sendEmail({
        to: admin.email,
        subject: "Demande d'annulation exceptionnelle — Meri Beauty",
        text: `Bonjour ${admin.fullName},\n\n${customerName} a soumis une demande d'annulation exceptionnelle pour « ${title} » (${label}).\n\nMotif : ${reason}\n\nOuvrez le tableau de bord pour l'accepter ou la refuser.`,
        html: `<p>Bonjour ${escapeHtml(admin.fullName)},</p><p><strong>${escapeHtml(customerName)}</strong> a soumis une demande d'annulation exceptionnelle pour « ${escapeHtml(title)} » (${escapeHtml(label)}).</p><p><strong>Motif :</strong> ${escapeHtml(reason)}</p><p>Ouvrez le tableau de bord pour l'accepter ou la refuser.</p>`,
      })
    )
  );
}

/** Customer-only. Records the request; changes nothing about the reservation or the money. */
export async function submitReservationCancellationRequest(input) {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Demande invalide." };
  }

  const session = await auth();
  if (!session?.user?.id) return { success: false, message: "Authentification requise." };
  if (session.user.role !== "CUSTOMER") {
    return { success: false, message: "Seul le client peut envoyer cette demande depuis son espace." };
  }

  const config = KINDS[parsed.data.kind];
  const reservation = await config.delegate(prisma).findUnique({
    where: { id: parsed.data.reservationId },
    include: config.include,
  });

  // Same message for "doesn't exist" and "isn't yours" — a reservation id
  // must not be confirmable by a stranger.
  if (!reservation || reservation.customerId !== session.user.id) {
    return { success: false, message: "Réservation introuvable." };
  }
  if (!["PENDING_DEPOSIT", "CONFIRMED"].includes(reservation.status)) {
    return { success: false, message: "Cette réservation ne peut plus faire l'objet d'une demande." };
  }

  try {
    await prisma.reservationCancellationRequest.create({
      data: {
        [config.idField]: reservation.id,
        requestedByUserId: session.user.id,
        reason: parsed.data.reason,
      },
    });

    await notifyAdmins({
      reason: parsed.data.reason,
      customerName: session.user.name ?? session.user.email,
      title: config.titleOf(reservation),
      label: config.label,
    }).catch((error) => console.error("[submitReservationCancellationRequest] notification", error));

    refreshViews();
    return {
      success: true,
      message: "Votre demande a été transmise à l'équipe. Votre réservation et votre acompte restent inchangés jusqu'à sa décision.",
    };
  } catch (error) {
    if (error?.code === "P2002") {
      return { success: false, message: "Une demande est déjà enregistrée pour cette réservation. L'équipe vous répondra dès que possible." };
    }
    console.error("[submitReservationCancellationRequest]", error);
    return { success: false, message: "Impossible d'envoyer votre demande. Réessayez ou contactez le salon." };
  }
}

export async function getReservationCancellationRequests() {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  const rows = await prisma.reservationCancellationRequest.findMany({
    include: {
      requestedBy: { select: { fullName: true, email: true, phone: true } },
      reviewedBy: { select: { fullName: true } },
      workshopReservation: {
        include: {
          session: { include: { workshop: { select: { title: true } } } },
          payment: { select: { paidAmount: true, paymentType: true, status: true } },
        },
      },
      formationReservation: {
        include: {
          session: { include: { formation: { select: { title: true } } } },
          payment: { select: { paidAmount: true, paymentType: true, status: true } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });

  return { success: true, data: JSON.parse(JSON.stringify(rows)) };
}

/**
 * Admin-only. Approving is the only path from a request to an actual
 * cancellation + deposit refund — it delegates to the same admin cancel
 * action the dashboard uses, rather than re-implementing refund logic.
 */
export async function reviewReservationCancellationRequest(input) {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Décision invalide." };

  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const request = await prisma.reservationCancellationRequest.findUnique({
    where: { id: parsed.data.requestId },
    include: {
      requestedBy: { select: { fullName: true, email: true } },
      workshopReservation: { select: { id: true } },
      formationReservation: { select: { id: true } },
    },
  });
  if (!request || request.status !== "PENDING") {
    return { success: false, message: "Cette demande a déjà été traitée ou n'existe plus." };
  }

  const kind = request.workshopReservationId ? "WORKSHOP" : "FORMATION";
  const config = KINDS[kind];
  const reservationId = request.workshopReservationId ?? request.formationReservationId;
  const decisionNote = parsed.data.decisionNote?.trim() || null;

  if (parsed.data.decision === "REJECTED") {
    const claim = await prisma.reservationCancellationRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "REJECTED", reviewedAt: new Date(), reviewedByUserId: guard.session.user.id, decisionNote },
    });
    if (!claim.count) return { success: false, message: "Cette demande vient d'être traitée." };

    await sendEmail({
      to: request.requestedBy.email,
      subject: "Décision concernant votre demande — Meri Beauty",
      text: `Bonjour ${request.requestedBy.fullName},\n\nVotre demande d'annulation exceptionnelle n'a pas été acceptée. Votre réservation et votre acompte restent inchangés.${decisionNote ? `\n\nMessage de l'équipe : ${decisionNote}` : ""}\n\nL'équipe Meri Beauty`,
      html: `<p>Bonjour ${escapeHtml(request.requestedBy.fullName)},</p><p>Votre demande d'annulation exceptionnelle n'a pas été acceptée. Votre réservation et votre acompte restent inchangés.</p>${decisionNote ? `<p><strong>Message de l'équipe :</strong> ${escapeHtml(decisionNote)}</p>` : ""}<p>L'équipe Meri Beauty</p>`,
    }).catch((error) => console.error("[reviewReservationCancellationRequest] rejection email", error));

    refreshViews();
    return { success: true, message: "Demande refusée. Le client a été informé." };
  }

  // Claim before cancelling so two administrators can't both approve and
  // fire two refunds. If the cancellation itself fails, put it back to
  // PENDING so it stays visible for another review rather than silently
  // reading as approved with nothing having happened.
  const claim = await prisma.reservationCancellationRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: { status: "APPROVED", reviewedAt: new Date(), reviewedByUserId: guard.session.user.id, decisionNote },
  });
  if (!claim.count) return { success: false, message: "Cette demande vient d'être traitée." };

  const result = await config.cancel(
    reservationId,
    `Annulation exceptionnelle approuvée par l'administration${decisionNote ? ` : ${decisionNote}` : ""}`
  );

  if (!result.success) {
    await prisma.reservationCancellationRequest.updateMany({
      where: { id: request.id, status: "APPROVED" },
      data: { status: "PENDING", reviewedAt: null, reviewedByUserId: null, decisionNote: null },
    });
    return result;
  }

  refreshViews();
  return {
    success: true,
    message: "Demande approuvée : la réservation est annulée et l'acompte est remboursé.",
  };
}
