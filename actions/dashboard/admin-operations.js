"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { TYPE_FILTERS, STATUS_FILTERS } from "@/lib/dashboard/operation-filters";

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
            payment: {
              select: {
                status: true,
                paymentType: true,
                // The row's invoice drives the download / e-mail actions.
                // Absent for a payment that never produced one (a deposit
                // collected before settlement, an appointment paid in part),
                // which the UI has to show as "pas encore de facture" rather
                // than a dead button.
                invoice: { select: { id: true, number: true, billitSentAt: true } },
                order: { select: { id: true, orderNumber: true, user: { select: { fullName: true, email: true } } } },
                workshopReservation: { select: { id: true, session: { select: { workshop: { select: { title: true } } } }, customer: { select: { fullName: true, email: true } } } },
                formationReservation: { select: { id: true, session: { select: { formation: { select: { title: true } } } }, customer: { select: { fullName: true, email: true } } } },
                appointment: { select: { id: true, date: true, user: { select: { fullName: true, email: true } } } },
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
        payment: {
          include: {
            invoice: { select: { id: true, number: true, issuedAt: true, subtotalExclVat: true, vatRate: true, vatAmount: true, totalInclVat: true, vatTreatment: true } },
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
