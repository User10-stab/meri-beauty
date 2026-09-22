"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { isBelgianVatNumber } from "@/lib/peppyrus";
import {
  INVOICES_PAGE_SIZE,
  buildInvoiceWhere,
  creditNoteEligibility,
  normalizeInvoiceFilters,
} from "@/lib/invoices/list-filters";

/**
 * The Factures page: every issued invoice, its delivery state (e-mail,
 * Peppol) and its credit notes. Read-only — sending goes through the
 * existing sendInvoiceByEmail / sendInvoiceToPeppyrus actions and the credit
 * note through cancelAndRefund, each of which re-checks the admin role.
 *
 * There is deliberately no delete: an issued invoice is a numbered legal
 * document, and removing one leaves a hole in the gapless F-series (exactly
 * what happened to F-2026-000003 and F-2026-000010 in prod before this
 * page existed). A wrong invoice is corrected by a credit note.
 */

const money = (value) => Number(value ?? 0);

function itemOf(payment) {
  if (!payment) return { itemKind: null, itemStatus: null, itemRef: null };
  if (payment.order) return { itemKind: "ORDER", itemStatus: payment.order.status, itemRef: `Commande n°${payment.order.orderNumber}` };
  if (payment.appointment) return { itemKind: "APPOINTMENT", itemStatus: payment.appointment.status, itemRef: "Rendez-vous" };
  if (payment.workshopReservation) return { itemKind: "WORKSHOP", itemStatus: payment.workshopReservation.status, itemRef: "Réservation atelier" };
  if (payment.formationReservation) return { itemKind: "FORMATION", itemStatus: payment.formationReservation.status, itemRef: "Réservation formation" };
  return { itemKind: null, itemStatus: null, itemRef: null };
}

export async function listInvoices(rawFilters = {}) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Non autorisé." };
  }

  const filters = normalizeInvoiceFilters(rawFilters);
  const where = buildInvoiceWhere(filters);

  try {
    const [total, invoices, totals, unsent, peppolPending] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        orderBy: [{ issuedAt: "desc" }, { number: "desc" }],
        skip: (filters.page - 1) * INVOICES_PAGE_SIZE,
        take: INVOICES_PAGE_SIZE,
        select: {
          id: true,
          number: true,
          source: true,
          paymentId: true,
          issuedAt: true,
          dueDate: true,
          customerName: true,
          customerEmail: true,
          customerType: true,
          customerLegalName: true,
          customerVatNumber: true,
          subtotalExclVat: true,
          vatRate: true,
          vatAmount: true,
          totalInclVat: true,
          emailSentAt: true,
          peppyrusSentAt: true,
          supersededAt: true,
          supersededReason: true,
          creditNotes: {
            orderBy: { issuedAt: "asc" },
            select: { id: true, number: true, reason: true, issuedAt: true, totalInclVat: true, emailSentAt: true, peppyrusSentAt: true },
          },
          payment: {
            select: {
              // A rent credit note refunds a paid rent: the dialog needs to know.
              paidAmount: true,
              // The Paiement column reads this, never an assumption: a rent
              // invoice is issued before it is paid.
              status: true,
              order: { select: { orderNumber: true, status: true } },
              appointment: { select: { status: true } },
              workshopReservation: { select: { status: true } },
              formationReservation: { select: { status: true } },
              _count: { select: { refundOperations: true } },
            },
          },
        },
      }),
      prisma.invoice.aggregate({ where, _sum: { totalInclVat: true } }),
      prisma.invoice.count({ where: { AND: [where, { emailSentAt: null, peppyrusSentAt: null }] } }),
      prisma.invoice.count({
        where: { AND: [where, { customerType: "B2B", customerVatNumber: { startsWith: "BE", mode: "insensitive" }, peppyrusSentAt: null }] },
      }),
    ]);

    const rows = invoices.map((invoice) => {
      const item = itemOf(invoice.payment);
      const creditNotes = invoice.creditNotes.map((note) => ({ ...note, totalInclVat: money(note.totalInclVat) }));
      const creditedTotal = creditNotes.reduce((sum, note) => sum + note.totalInclVat, 0);
      const base = {
        id: invoice.id,
        number: invoice.number,
        source: invoice.source,
        paymentId: invoice.paymentId,
        issuedAt: invoice.issuedAt,
        dueDate: invoice.dueDate,
        customerName: invoice.customerName,
        customerEmail: invoice.customerEmail,
        customerType: invoice.customerType,
        customerLegalName: invoice.customerLegalName,
        customerVatNumber: invoice.customerVatNumber,
        subtotalExclVat: money(invoice.subtotalExclVat),
        vatRate: money(invoice.vatRate),
        vatAmount: money(invoice.vatAmount),
        totalInclVat: money(invoice.totalInclVat),
        emailSentAt: invoice.emailSentAt,
        peppyrusSentAt: invoice.peppyrusSentAt,
        peppolApplicable: invoice.customerType === "B2B" && isBelgianVatNumber(invoice.customerVatNumber),
        supersededAt: invoice.supersededAt,
        supersededReason: invoice.supersededReason,
        creditNotes,
        creditedTotal,
        refundOperationCount: invoice.payment?._count?.refundOperations ?? 0,
        paidAmount: money(invoice.payment?.paidAmount ?? 0),
        paymentStatus: invoice.payment?.status ?? null,
        ...item,
      };
      const eligibility = creditNoteEligibility(base);
      return { ...base, canGenerateCreditNote: eligibility.allowed, creditNoteBlockedReason: eligibility.reason };
    });

    return {
      success: true,
      data: {
        filters,
        rows,
        pagination: { page: filters.page, pageSize: INVOICES_PAGE_SIZE, total, pageCount: Math.max(1, Math.ceil(total / INVOICES_PAGE_SIZE)) },
        stats: { count: total, totalInclVat: money(totals._sum.totalInclVat), unsent, peppolPending },
      },
    };
  } catch (error) {
    console.error("[listInvoices]", error);
    return { success: false, message: "Impossible de charger les factures." };
  }
}
