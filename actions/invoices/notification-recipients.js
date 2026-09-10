"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { notificationRecipientSchema } from "@/lib/validations/notification-recipient";

/**
 * CRUD for the global internal address book shown in DocumentDeliveryDialog
 * when an admin chooses to deliver a B2B invoice / credit note by e-mail.
 *
 * Admin-gated with the same inline check every sibling file in this folder
 * uses (send-invoice-email.js, send-invoice-peppyrus.js …), not a wrapper.
 * These are called straight from the dialog's local state, so there is no
 * server component to revalidate. The actual sends are what get audited —
 * mirroring admin-accounts.js, editing this list is not itself logged.
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { error: { success: false, message: "Non autorisé." } };
  }
  return { session };
}

export async function listNotificationRecipients() {
  const guard = await requireAdmin();
  if (guard.error) return { ...guard.error, data: [] };

  const data = await prisma.notificationRecipient.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return { success: true, data };
}

export async function createNotificationRecipient(input) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const parsed = notificationRecipientSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return { success: false, message: fieldErrors.email?.[0] ?? fieldErrors.label?.[0] ?? "Adresse invalide." };
  }

  try {
    const recipient = await prisma.notificationRecipient.create({ data: parsed.data });
    return { success: true, message: `${recipient.email} ajouté à la liste.`, data: recipient };
  } catch (error) {
    if (error?.code === "P2002") return { success: false, message: "Cette adresse figure déjà dans la liste." };
    console.error("[createNotificationRecipient]", error);
    return { success: false, message: "Impossible d'ajouter cette adresse." };
  }
}

export async function updateNotificationRecipient(id, input) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  if (typeof id !== "string" || !id) return { success: false, message: "Destinataire introuvable." };

  const parsed = notificationRecipientSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return { success: false, message: fieldErrors.email?.[0] ?? fieldErrors.label?.[0] ?? "Adresse invalide." };
  }

  try {
    const recipient = await prisma.notificationRecipient.update({ where: { id }, data: parsed.data });
    return { success: true, message: `${recipient.email} mis à jour.`, data: recipient };
  } catch (error) {
    if (error?.code === "P2002") return { success: false, message: "Cette adresse figure déjà dans la liste." };
    if (error?.code === "P2025") return { success: false, message: "Destinataire introuvable." };
    console.error("[updateNotificationRecipient]", error);
    return { success: false, message: "Impossible de modifier cette adresse." };
  }
}

export async function deleteNotificationRecipient(id) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  if (typeof id !== "string" || !id) return { success: false, message: "Destinataire introuvable." };

  try {
    await prisma.notificationRecipient.delete({ where: { id } });
    return { success: true, message: "Adresse supprimée." };
  } catch (error) {
    if (error?.code === "P2025") return { success: false, message: "Destinataire introuvable." };
    console.error("[deleteNotificationRecipient]", error);
    return { success: false, message: "Impossible de supprimer cette adresse." };
  }
}
