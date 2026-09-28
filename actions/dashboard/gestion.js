"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { writeAuditLog, AUDIT_ACTIONS } from "@/lib/audit-log";
import { normalizeGestionParams } from "@/lib/gestion/filters";
import { buildGestionReport } from "@/lib/gestion/build-gestion-report";
import { parseSalonExpenseInput } from "@/lib/gestion/expenses";

/**
 * Gestion: the salon's net margin over a period, and the running costs
 * (électricité, eau, internet, loyer…) it is computed against.
 *
 * Same OWNER/ADMIN tier as the Livre de recettes it reads its revenue from.
 * Every export of a "use server" file is a public endpoint, so each one
 * re-checks the role itself.
 */
async function requireGestionAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.REPORTS)) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

/** @param {{ from?: string, to?: string, category?: string }} [params] */
export async function getGestionReport(params = {}) {
  const guard = await requireGestionAccess();
  if (guard.error) return { success: false, message: guard.error };

  try {
    const data = await buildGestionReport(prisma, normalizeGestionParams(params));
    return { success: true, data: serializeDecimalFields(data) };
  } catch (error) {
    console.error("[getGestionReport]", error);
    return { success: false, message: "Impossible de charger la gestion." };
  }
}

function snapshot(expense) {
  return {
    category: expense.category,
    label: expense.label,
    amountTtc: Number(expense.amountTtc),
    vatRate: Number(expense.vatRate),
    date: expense.date,
    isRecurring: expense.isRecurring,
    endDate: expense.endDate,
    note: expense.note,
  };
}

export async function createSalonExpense(input) {
  const guard = await requireGestionAccess();
  if (guard.error) return { success: false, message: guard.error };

  const { data, errors } = parseSalonExpenseInput(input);
  if (errors) return { success: false, message: "Vérifiez les champs du formulaire.", errors };

  const expense = await prisma.$transaction(async (tx) => {
    const created = await tx.salonExpense.create({
      data: { ...data, createdById: guard.session.user.id },
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.SALON_EXPENSE_CREATED,
      entityType: "SalonExpense",
      entityId: created.id,
      after: snapshot(created),
    });
    return created;
  });

  revalidatePath("/dashboard/gestion");
  return { success: true, message: "Charge ajoutée.", data: { id: expense.id } };
}

export async function updateSalonExpense(id, input) {
  const guard = await requireGestionAccess();
  if (guard.error) return { success: false, message: guard.error };
  if (typeof id !== "string" || !id) return { success: false, message: "Charge introuvable." };

  const { data, errors } = parseSalonExpenseInput(input);
  if (errors) return { success: false, message: "Vérifiez les champs du formulaire.", errors };

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.salonExpense.findFirst({ where: { id, isDeleted: false } });
    if (!existing) return { error: "Charge introuvable." };
    const updated = await tx.salonExpense.update({ where: { id }, data });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.SALON_EXPENSE_UPDATED,
      entityType: "SalonExpense",
      entityId: id,
      before: snapshot(existing),
      after: snapshot(updated),
    });
    return { updated };
  });

  if (outcome.error) return { success: false, message: outcome.error };
  revalidatePath("/dashboard/gestion");
  return { success: true, message: "Charge modifiée." };
}

/** Soft delete — the row stays for the audit trail, it just stops counting. */
export async function deleteSalonExpense(id) {
  const guard = await requireGestionAccess();
  if (guard.error) return { success: false, message: guard.error };
  if (typeof id !== "string" || !id) return { success: false, message: "Charge introuvable." };

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.salonExpense.findFirst({ where: { id, isDeleted: false } });
    if (!existing) return { error: "Charge introuvable." };
    await tx.salonExpense.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.SALON_EXPENSE_DELETED,
      entityType: "SalonExpense",
      entityId: id,
      before: snapshot(existing),
    });
    return {};
  });

  if (outcome.error) return { success: false, message: outcome.error };
  revalidatePath("/dashboard/gestion");
  return { success: true, message: "Charge supprimée." };
}
