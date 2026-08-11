"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { DASHBOARD_PERMISSIONS, hasPermission } from "@/lib/authorization";
import { captureError } from "@/lib/monitoring";

const DISPUTES_PATH = "/dashboard/payments/disputes";

async function requireDisputeAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.STRIPE_DISPUTES)) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

const DISPUTE_INCLUDE = {
  payment: {
    include: {
      order: { select: { orderNumber: true, trackingCode: true, pickedUpAt: true, user: { select: { fullName: true, email: true } } } },
      appointment: { select: { date: true, user: { select: { fullName: true, email: true } } } },
      workshopReservation: {
        select: { session: { select: { workshop: { select: { title: true } } } }, customer: { select: { fullName: true, email: true } } },
      },
      formationReservation: {
        select: { session: { select: { formation: { select: { title: true } } } }, customer: { select: { fullName: true, email: true } } },
      },
      invoice: { select: { id: true, number: true } },
    },
  },
  assignedStaff: { select: { id: true, fullName: true } },
};

function serializeDispute(dispute) {
  const payment = dispute.payment;
  let type = "Paiement";
  let reference = payment.id;
  let customerName = null;
  let customerEmail = null;
  let shipmentHint = null;

  if (payment.order) {
    type = "Commande";
    reference = `n°${payment.order.orderNumber}`;
    customerName = payment.order.user?.fullName ?? null;
    customerEmail = payment.order.user?.email ?? null;
    shipmentHint = payment.order.trackingCode
      ? `Suivi Mondial Relay : ${payment.order.trackingCode}`
      : payment.order.pickedUpAt
        ? `Retiré en magasin le ${new Date(payment.order.pickedUpAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })}`
        : null;
  } else if (payment.appointment) {
    type = "Rendez-vous";
    reference = payment.appointment.date ? new Date(payment.appointment.date).toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" }) : "—";
    customerName = payment.appointment.user?.fullName ?? null;
    customerEmail = payment.appointment.user?.email ?? null;
  } else if (payment.workshopReservation) {
    type = "Atelier";
    reference = payment.workshopReservation.session?.workshop?.title ?? "—";
    customerName = payment.workshopReservation.customer?.fullName ?? null;
    customerEmail = payment.workshopReservation.customer?.email ?? null;
  } else if (payment.formationReservation) {
    type = "Formation";
    reference = payment.formationReservation.session?.formation?.title ?? "—";
    customerName = payment.formationReservation.customer?.fullName ?? null;
    customerEmail = payment.formationReservation.customer?.email ?? null;
  }

  return {
    id: dispute.id,
    paymentId: payment.id,
    type,
    reference,
    customerName,
    customerEmail,
    amount: Number(dispute.amount),
    reason: dispute.reason,
    status: dispute.status,
    dueBy: dispute.dueBy,
    shipmentHint,
    invoiceId: payment.invoice?.id ?? null,
    invoiceNumber: payment.invoice?.number ?? null,
    assignedStaffId: dispute.assignedStaffId,
    assignedStaffName: dispute.assignedStaff?.fullName ?? null,
    responseSentAt: dispute.responseSentAt,
    proofOfShipmentReference: dispute.proofOfShipmentReference,
    conclusion: dispute.conclusion,
    createdAt: dispute.createdAt,
  };
}

/**
 * Dashboard "Litiges Stripe" list — the persistent dossier for every dispute
 * charge.dispute.created has ever recorded (see
 * app/api/webhooks/stripe/route.js), newest/most urgent first. Open disputes
 * are unresolved chargebacks that risk both the sale and a Stripe dispute
 * fee if nobody responds by the deadline; this is the durable, visible
 * record an admin can act on instead of relying only on the one-shot alert
 * email.
 */
export async function listDisputes() {
  const guard = await requireDisputeAccess();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  try {
    const disputes = await prisma.stripeDispute.findMany({
      include: DISPUTE_INCLUDE,
      orderBy: [{ dueBy: "asc" }, { createdAt: "desc" }],
    });
    return { success: true, data: disputes.map(serializeDispute) };
  } catch (error) {
    captureError(error, { area: "stripe-disputes", context: "listDisputes" });
    return { success: false, message: "Impossible de charger les litiges Stripe.", data: [] };
  }
}

/** OWNER/ADMIN users selectable as the dossier's responsable. */
export async function listDisputeAssignees() {
  const guard = await requireDisputeAccess();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  const staff = await prisma.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN"] }, isActive: true, isDeleted: false },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  return { success: true, data: staff };
}

/**
 * Staff-facing edits to the dossier — everything Stripe itself doesn't
 * track for us: who's responsible, whether/when evidence was actually
 * submitted, what proof was cited, and the eventual conclusion once the
 * dispute closes. Never touches status/amount/reason/dueBy — those stay
 * exclusively webhook-owned so the dossier can't drift from what Stripe
 * actually reports.
 */
export async function updateDisputeDossier({ disputeId, assignedStaffId, responseSent, proofOfShipmentReference, conclusion }) {
  const guard = await requireDisputeAccess();
  if (guard.error) return { success: false, message: guard.error };
  if (!disputeId) return { success: false, message: "Litige manquant." };

  try {
    const existing = await prisma.stripeDispute.findUnique({ where: { id: disputeId }, select: { responseSentAt: true } });
    if (!existing) return { success: false, message: "Litige introuvable." };

    await prisma.stripeDispute.update({
      where: { id: disputeId },
      data: {
        assignedStaffId: assignedStaffId || null,
        responseSentAt: responseSent === false ? null : responseSent === true ? existing.responseSentAt ?? new Date() : undefined,
        proofOfShipmentReference: proofOfShipmentReference?.trim() || null,
        conclusion: conclusion?.trim() || null,
      },
    });

    revalidatePath(DISPUTES_PATH);
    return { success: true, message: "Dossier mis à jour." };
  } catch (error) {
    captureError(error, { area: "stripe-disputes", context: "updateDisputeDossier", disputeId });
    return { success: false, message: "Impossible de mettre à jour le dossier." };
  }
}
