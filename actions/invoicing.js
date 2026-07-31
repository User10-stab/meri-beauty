"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { DASHBOARD_PERMISSIONS, hasPermission } from "@/lib/authorization";

async function requireInvoicesAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.INVOICES)) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

function serializeInvoice(invoice) {
  return {
    id: invoice.id,
    number: invoice.number,
    source: invoice.source,
    issuedAt: invoice.issuedAt,
    customerName: invoice.customerName,
    customerEmail: invoice.customerEmail,
    totalInclVat: Number(invoice.totalInclVat),
    creditNotes: (invoice.creditNotes ?? []).map((cn) => ({
      id: cn.id,
      number: cn.number,
      issuedAt: cn.issuedAt,
      totalInclVat: Number(cn.totalInclVat),
    })),
    orderId: invoice.payment?.orderId ?? null,
    orderNumber: invoice.payment?.order?.orderNumber ?? null,
    appointmentId: invoice.payment?.appointmentId ?? null,
  };
}

/** Dashboard "Factures" list — admin/owner only, spans orders + appointments. */
export async function listInvoices({ search, source } = {}) {
  const guard = await requireInvoicesAccess();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        ...(source ? { source } : {}),
        ...(search
          ? {
              OR: [
                { number: { contains: search, mode: "insensitive" } },
                { customerName: { contains: search, mode: "insensitive" } },
                { customerEmail: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { issuedAt: "desc" },
      include: {
        creditNotes: true,
        payment: { select: { orderId: true, appointmentId: true, order: { select: { orderNumber: true } } } },
      },
      take: 200,
    });

    return { success: true, data: invoices.map(serializeInvoice) };
  } catch (error) {
    console.error("[listInvoices]", error);
    return { success: false, message: "Impossible de charger les factures.", data: [] };
  }
}
