"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { TYPE_FILTERS, STATUS_FILTERS } from "@/lib/dashboard/operation-filters";
import { issueCreditNote } from "@/lib/invoicing";

const ADMIN_OPERATION_TABS = Object.freeze(["transactions", "orders", "workshops", "formations"]);
const PAGE_SIZE = 30;

function normalizeParams(params = {}) {
  const tab = ADMIN_OPERATION_TABS.includes(params.tab) ? params.tab : "transactions";
  const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
  const type = TYPE_FILTERS[tab]?.includes(params.type) ? params.type : "ALL";
  const status = STATUS_FILTERS[tab]?.includes(params.status) ? params.status : "ALL";
  return { tab, page, type, status };
}

async function requireAdminOperationsAccess() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) return null;
  return session;
}

/**
 * Paginated, admin-only operational ledger. Keeping one tab's query per
 * request prevents a growing transaction/order history from slowing the
 * dashboard just because another tab is not currently being viewed.
 */
export async function getAdminOperations(params = {}) {
  if (!(await requireAdminOperationsAccess())) {
    return { success: false, message: "Non autorisé.", data: [], totalCount: 0, page: 1, pageSize: PAGE_SIZE };
  }

  const { tab, page, type, status } = normalizeParams(params);
  const skip = (page - 1) * PAGE_SIZE;

  try {
    let result;
    if (tab === "transactions") {
      // Transaction has no separate "status" column of its own — the filter
      // slot doubles for transactionType (DEPOSIT/FINAL_PAYMENT/REFUND),
      // which is what actually varies row to row on this tab.
      const where = { isDeleted: false, ...(status !== "ALL" && { transactionType: status }) };
      const [totalCount, data] = await Promise.all([
        prisma.transaction.count({ where }),
        prisma.transaction.findMany({
          where,
          orderBy: { paidAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: {
            // A refund row links to exactly one credit note (Transaction.
            // creditNoteId), never to "whichever ones exist on the invoice" —
            // an invoice can carry several partial refunds over time, and a
            // blanket list would attach every one of them to every row.
            creditNote: { select: { id: true, number: true, totalInclVat: true } },
            payment: {
              select: {
                status: true,
                paymentType: true,
                // The row's invoice drives the download / e-mail actions.
                // Absent for a payment that never produced one (a deposit
                // collected before settlement, an appointment paid in part),
                // which the UI has to show as "pas encore de facture" rather
                // than a dead button.
                invoice: {
                  select: { id: true, number: true, billitSentAt: true, customerType: true, customerVatNumber: true },
                },
                order: { select: { id: true, orderNumber: true, user: { select: { fullName: true, email: true, vatNumber: true } } } },
                workshopReservation: { select: { id: true, session: { select: { workshop: { select: { title: true } } } }, customer: { select: { fullName: true, email: true, vatNumber: true } } } },
                formationReservation: { select: { id: true, session: { select: { formation: { select: { title: true } } } }, customer: { select: { fullName: true, email: true, vatNumber: true } } } },
                appointment: { select: { id: true, date: true, user: { select: { fullName: true, email: true, vatNumber: true } } } },
              },
            },
          },
        }),
      ]);
      result = { totalCount, data };
    } else if (tab === "orders") {
      const where = status !== "ALL" ? { status } : {};
      const [totalCount, data] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: {
            user: { select: { fullName: true, email: true } },
            payment: { select: { status: true, paidAmount: true, remainingAmount: true } },
            _count: { select: { items: true } },
          },
        }),
      ]);
      result = { totalCount, data };
    } else if (tab === "workshops") {
      // "Ateliers & événements" is one table because they share a booking
      // flow — but an atelier and an événement read as different business
      // lines, so the type filter is what actually separates them.
      const where = {
        ...(status !== "ALL" && { status }),
        ...(type !== "ALL" && { session: { workshop: { type } } }),
      };
      const [totalCount, data] = await Promise.all([
        prisma.workshopReservation.count({ where }),
        prisma.workshopReservation.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: {
            customer: { select: { fullName: true, email: true } },
            payment: { select: { status: true, paidAmount: true, remainingAmount: true } },
            session: { select: { startDate: true, workshop: { select: { title: true, type: true } } } },
          },
        }),
      ]);
      result = { totalCount, data };
    } else {
      const where = {
        ...(status !== "ALL" && { status }),
        ...(type !== "ALL" && { session: { formation: { type } } }),
      };
      const [totalCount, data] = await Promise.all([
        prisma.formationReservation.count({ where }),
        prisma.formationReservation.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: {
            customer: { select: { fullName: true, email: true } },
            payment: { select: { status: true, paidAmount: true, remainingAmount: true } },
            session: { select: { startDate: true, formation: { select: { title: true, type: true } } } },
          },
        }),
      ]);
      result = { totalCount, data };
    }

    return {
      success: true,
      tab,
      page,
      type,
      status,
      pageSize: PAGE_SIZE,
      totalCount: result.totalCount,
      data: serializeDecimalFields(result.data),
    };
  } catch (error) {
    console.error("[getAdminOperations]", error);
    return { success: false, tab, page, type, status, pageSize: PAGE_SIZE, totalCount: 0, data: [], message: "Impossible de charger les opérations." };
  }
}

/**
 * Everything the operations table cannot fit on one row, for the detail
 * drawer: the full payment context, its sibling transactions, and the
 * invoice if one was issued.
 *
 * A separate round trip rather than more `include` on the list query — the
 * list renders 30 rows per page and only ever one of them gets opened.
 */
export async function getTransactionDetail(transactionId) {
  if (!(await requireAdminOperationsAccess())) {
    return { success: false, message: "Non autorisé." };
  }
  if (typeof transactionId !== "string" || !transactionId) {
    return { success: false, message: "Transaction introuvable." };
  }

  try {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        cashSession: { select: { id: true, openedAt: true, closedAt: true } },
        // This row's own credit note, if any — not every credit note ever
        // issued against the invoice (see getAdminOperations' same choice).
        creditNote: { select: { id: true, number: true, issuedAt: true, reason: true, totalInclVat: true } },
        payment: {
          include: {
            invoice: {
              select: {
                id: true,
                number: true,
                issuedAt: true,
                subtotalExclVat: true,
                vatRate: true,
                vatAmount: true,
                totalInclVat: true,
                vatTreatment: true,
              },
            },
            // Sibling transactions: a 50 % acompte followed by a balance
            // settled at the counter are two rows against one Payment, and
            // reading either one alone misrepresents what the customer paid.
            transactions: { orderBy: { paidAt: "asc" }, select: { id: true, amount: true, method: true, transactionType: true, paidAt: true, isDeleted: true } },
            order: { select: { id: true, orderNumber: true, status: true, fulfilmentMode: true, user: { select: { fullName: true, email: true } } } },
            workshopReservation: { select: { id: true, status: true, seatsCount: true, session: { select: { startDate: true, workshop: { select: { title: true, type: true } } } }, customer: { select: { fullName: true, email: true } } } },
            formationReservation: { select: { id: true, status: true, seatsCount: true, session: { select: { startDate: true, formation: { select: { title: true, type: true } } } }, customer: { select: { fullName: true, email: true } } } },
            appointment: { select: { id: true, date: true, status: true, user: { select: { fullName: true, email: true } } } },
          },
        },
      },
    });

    if (!transaction) return { success: false, message: "Transaction introuvable." };

    return { success: true, data: serializeDecimalFields(transaction) };
  } catch (error) {
    console.error("[getTransactionDetail]", error);
    return { success: false, message: "Impossible de charger le détail de cette transaction." };
  }
}

/**
 * Manual remediation for a REFUND row that never got a credit note through
 * the normal cancellation/return flows — a refund issued by hand from the
 * Stripe Dashboard, or one recorded before Transaction.creditNoteId existed.
 * Every automatic path already issues one itself; this only ever fills a gap,
 * never re-issues over an existing link (see the creditNoteId check below).
 */
export async function issueCreditNoteForTransaction(transactionId, reason) {
  const session = await requireAdminOperationsAccess();
  if (!session) return { success: false, message: "Non autorisé." };
  if (typeof transactionId !== "string" || !transactionId) {
    return { success: false, message: "Transaction introuvable." };
  }

  try {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        amount: true,
        transactionType: true,
        creditNoteId: true,
        payment: { select: { invoice: { select: { id: true } } } },
      },
    });
    if (!transaction) return { success: false, message: "Transaction introuvable." };
    if (transaction.creditNoteId) {
      return { success: false, message: "Cette transaction a déjà une note de crédit associée." };
    }
    if (!transaction.payment?.invoice) {
      return { success: false, message: "Aucune facture n'est associée à ce paiement — impossible d'émettre une note de crédit." };
    }

    const result = await prisma.$transaction(async (tx) => {
      // Serialize two clicks on the same refund. Without this lock, both
      // requests could observe the missing link before either one creates it.
      await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${transaction.id} FOR UPDATE`;

      const lockedTransaction = await tx.transaction.findUnique({
        where: { id: transaction.id },
        select: {
          creditNote: { select: { id: true, number: true } },
        },
      });
      if (lockedTransaction?.creditNote) {
        return { creditNote: lockedTransaction.creditNote, linkedExisting: true };
      }

      // Historical refunds may already have a legally numbered credit note
      // on the invoice but no Transaction.creditNoteId (the link did not
      // exist yet). Reuse the unique exact-amount orphan instead of issuing a
      // duplicate document that would exceed the invoice's creditable total.
      const matchingOrphans = await tx.creditNote.findMany({
        where: {
          invoiceId: transaction.payment.invoice.id,
          totalInclVat: transaction.amount,
          transaction: { is: null },
        },
        orderBy: { issuedAt: "asc" },
        take: 2,
        select: { id: true, number: true },
      });
      if (matchingOrphans.length > 1) {
        throw new Error("CREDIT_NOTE_LINK_AMBIGUOUS");
      }

      const linkedExisting = matchingOrphans.length === 1;
      const note = matchingOrphans[0] ?? await issueCreditNote(tx, {
        invoiceId: transaction.payment.invoice.id,
        reason: reason?.trim() || "Note de crédit générée manuellement",
        totalInclVat: Number(transaction.amount),
      });
      await tx.transaction.update({ where: { id: transaction.id }, data: { creditNoteId: note.id } });
      return { creditNote: note, linkedExisting };
    });

    revalidatePath("/dashboard/operations");
    return {
      success: true,
      message: result.linkedExisting
        ? `La note de crédit ${result.creditNote.number} existait déjà et a été associée à cette opération.`
        : `Note de crédit ${result.creditNote.number} générée.`,
      data: { creditNoteId: result.creditNote.id, number: result.creditNote.number },
    };
  } catch (error) {
    if (error.message === "CREDIT_NOTE_LINK_AMBIGUOUS") {
      return { success: false, message: "Plusieurs notes de crédit correspondent à ce remboursement. Vérifiez-les avant de faire l'association." };
    }
    if (error.message === "CREDIT_NOTE_EXCEEDS_INVOICE") {
      return { success: false, message: "Le montant dépasse ce qui reste créditable sur cette facture." };
    }
    console.error("[issueCreditNoteForTransaction]", error);
    return { success: false, message: "Impossible de générer la note de crédit." };
  }
}
