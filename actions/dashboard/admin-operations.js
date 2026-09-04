"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import {
  TYPE_FILTERS,
  PAYMENT_EVENT_FILTERS,
  LIFECYCLE_STATUS_FILTERS,
  OPERATION_PRESETS,
} from "@/lib/dashboard/operation-filters";
import { hasInvoiceableVatIdentity } from "@/lib/tax-policy";
import { summarizeRefundState } from "@/lib/refunds/plan-refund";

const ADMIN_OPERATION_TABS = Object.freeze(["transactions", "orders", "workshops", "formations"]);
const PAGE_SIZE = 30;

function resolveTransactionCustomer(payment) {
  return (
    payment?.order?.user ??
    payment?.workshopReservation?.customer ??
    payment?.formationReservation?.customer ??
    payment?.appointment?.user ??
    null
  );
}

function normalizeParams(params = {}) {
  const tab = ADMIN_OPERATION_TABS.includes(params.tab) ? params.tab : "transactions";
  const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
  const type = TYPE_FILTERS[tab]?.includes(params.type) ? params.type : "ALL";
  const lifecycleOptions = LIFECYCLE_STATUS_FILTERS[tab === "transactions" ? "all" : tab] ?? [];
  const lifecycleStatus = lifecycleOptions.includes(params.lifecycleStatus) ? params.lifecycleStatus : "ALL";
  const paymentEvent = PAYMENT_EVENT_FILTERS.includes(params.paymentEvent) ? params.paymentEvent : "ALL";
  return { tab, page, type, lifecycleStatus, paymentEvent };
}

async function requireAdminOperationsAccess() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) return null;
  return session;
}

// ─── Unified operations query ───────────────────────────────────────────────
//
// Prisma has no UNION, so this is a two-stage id-then-hydrate query:
//
//   Stage A (below): one raw-SQL UNION ALL across Order/WorkshopReservation/
//   FormationReservation (entity-grained — an order/booking is one row here
//   regardless of how many payment events it has), plus a fourth
//   Transaction-sourced arm for appointments, which keep today's
//   event-grained behaviour unchanged (they are not part of this
//   unification — see the module doc comment above getAdminOperations).
//   Selects just {id, sourceType} and does the actual paging/sorting/
//   filtering, so a growing history never has to be paged after the fact.
//
//   Stage B (hydrateXxx below): groups the page's ids by sourceType and runs
//   the ordinary Prisma `findMany({ where: { id: { in } } })` per source,
//   reusing the exact same `include` shapes the four tabs already used
//   before unification — only the selection/paging mechanism moved to SQL,
//   not the shape of the data fetched for display.
//
// Every column/type compared against a caller-supplied filter value is cast
// to ::text on the SQL side. OrderStatus, WorkshopReservationStatus and
// FormationReservationStatus are three distinct Postgres enums with
// non-overlapping labels (and TransactionType is a fourth) — comparing an
// enum column directly against a bound text parameter throws "operator does
// not exist", not "no rows", so every such comparison must go through this
// cast. Literal constants written directly into the SQL text (not bound
// parameters) don't need it — Postgres resolves an in-line string literal's
// type from context.

async function listUnifiedOperationIds({ sourceTypes, type, lifecycleStatus, paymentEvent, skip, take }) {
  const includeOrders = !sourceTypes || sourceTypes.includes("ORDER");
  const includeWorkshops = !sourceTypes || sourceTypes.includes("WORKSHOP");
  const includeFormations = !sourceTypes || sourceTypes.includes("FORMATION");
  // Appointments are only ever reachable from the unrestricted (transactions)
  // preset — Commandes/Ateliers/Formations never showed them before either.
  const includeAppointments = !sourceTypes;

  const arms = [];

  if (includeOrders) {
    arms.push(Prisma.sql`
      SELECT o.id AS id, 'ORDER' AS "sourceType", o."createdAt" AS "sortAt"
      FROM "Order" o
      WHERE 1=1
        ${lifecycleStatus !== "ALL" ? Prisma.sql`AND o."status"::text = ${lifecycleStatus}` : Prisma.empty}
        ${
          paymentEvent !== "ALL"
            ? Prisma.sql`AND EXISTS (
                SELECT 1 FROM "Payment" p JOIN "Transaction" t ON t."paymentId" = p.id
                WHERE p."orderId" = o.id AND t."isDeleted" = false AND t."transactionType"::text = ${paymentEvent}
              )`
            : Prisma.empty
        }
    `);
  }

  if (includeWorkshops) {
    arms.push(Prisma.sql`
      SELECT wr.id AS id, 'WORKSHOP' AS "sourceType", wr."createdAt" AS "sortAt"
      FROM "workshop_reservations" wr
      JOIN "workshop_sessions" ws ON ws.id = wr."sessionId"
      JOIN "workshops" w ON w.id = ws."workshopId"
      WHERE 1=1
        ${lifecycleStatus !== "ALL" ? Prisma.sql`AND wr."status"::text = ${lifecycleStatus}` : Prisma.empty}
        ${type !== "ALL" ? Prisma.sql`AND w."type"::text = ${type}` : Prisma.empty}
        ${
          paymentEvent !== "ALL"
            ? Prisma.sql`AND EXISTS (
                SELECT 1 FROM "Payment" p JOIN "Transaction" t ON t."paymentId" = p.id
                WHERE p."workshopReservationId" = wr.id AND t."isDeleted" = false AND t."transactionType"::text = ${paymentEvent}
              )`
            : Prisma.empty
        }
    `);
  }

  if (includeFormations) {
    arms.push(Prisma.sql`
      SELECT fr.id AS id, 'FORMATION' AS "sourceType", fr."createdAt" AS "sortAt"
      FROM "formation_reservations" fr
      JOIN "formation_sessions" fs ON fs.id = fr."sessionId"
      JOIN "formations" f ON f.id = fs."formationId"
      WHERE 1=1
        ${lifecycleStatus !== "ALL" ? Prisma.sql`AND fr."status"::text = ${lifecycleStatus}` : Prisma.empty}
        ${type !== "ALL" ? Prisma.sql`AND f."type"::text = ${type}` : Prisma.empty}
        ${
          paymentEvent !== "ALL"
            ? Prisma.sql`AND EXISTS (
                SELECT 1 FROM "Payment" p JOIN "Transaction" t ON t."paymentId" = p.id
                WHERE p."formationReservationId" = fr.id AND t."isDeleted" = false AND t."transactionType"::text = ${paymentEvent}
              )`
            : Prisma.empty
        }
    `);
  }

  if (includeAppointments) {
    // Mirrors the pre-unification Transactions-tab query exactly: one row
    // per payment EVENT (not per appointment), with the same
    // deposit-suppressed-once-a-balance-exists rule. No lifecycleStatus/type
    // axis applies to this source in this view — a status-filtered request
    // (e.g. "SHIPPED") correctly excludes appointments rather than matching
    // them by accident.
    arms.push(Prisma.sql`
      SELECT t.id AS id, 'APPOINTMENT' AS "sourceType", t."paidAt" AS "sortAt"
      FROM "Transaction" t
      JOIN "Payment" p ON p.id = t."paymentId"
      WHERE t."isDeleted" = false
        AND p."appointmentId" IS NOT NULL
        AND NOT (
          t."transactionType" = 'DEPOSIT'
          AND EXISTS (
            SELECT 1 FROM "Transaction" t2
            WHERE t2."paymentId" = t."paymentId" AND t2."isDeleted" = false AND t2."transactionType" = 'FINAL_PAYMENT'
          )
        )
        ${lifecycleStatus !== "ALL" ? Prisma.sql`AND false` : Prisma.empty}
        ${paymentEvent !== "ALL" ? Prisma.sql`AND t."transactionType"::text = ${paymentEvent}` : Prisma.empty}
    `);
  }

  if (arms.length === 0) return { ids: [], totalCount: 0 };

  const unioned = Prisma.join(arms, " UNION ALL ");

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT id, "sourceType" FROM (${unioned}) AS combined
      ORDER BY "sortAt" DESC
      LIMIT ${take} OFFSET ${skip}
    `,
    prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM (${unioned}) AS combined`,
  ]);

  return { ids: rows, totalCount: countRows[0]?.count ?? 0 };
}

// From a Payment's live transactions, the money summary and the id of the
// most recent event — the latter decides whether a row can open the detail
// drawer at all (InvoiceRowActions only gets onOpenDetail when this exists).
function deriveRefundFields(payment) {
  const transactions = (payment?.transactions ?? []).filter((t) => !t.isDeleted);
  const refundState = summarizeRefundState({ transactions, invoice: payment?.invoice ?? null });
  const latest = transactions.reduce(
    (best, t) => (!best || new Date(t.paidAt) > new Date(best.paidAt) ? t : best),
    null,
  );
  return {
    refundState: {
      totalCollected: refundState.totalCollected,
      totalRefunded: refundState.totalRefunded,
      remainingRefundable: refundState.remainingRefundable,
      fullyCredited: refundState.fullyCredited,
    },
    latestTransactionId: latest?.id ?? null,
    latestTransactionType: latest?.transactionType ?? null,
  };
}

const PAYMENT_LEDGER_SELECT = Object.freeze({
  id: true,
  status: true,
  paidAmount: true,
  remainingAmount: true,
  transactions: { select: { id: true, amount: true, transactionType: true, isDeleted: true, paidAt: true } },
  invoice: {
    select: {
      id: true,
      number: true,
      totalInclVat: true,
      emailSentAt: true,
      billitSentAt: true,
      customerType: true,
      customerVatNumber: true,
      creditNotes: { select: { id: true, number: true, totalInclVat: true, emailSentAt: true, billitSentAt: true } },
    },
  },
});

async function hydrateOrders(ids) {
  if (ids.length === 0) return [];
  const rows = await prisma.order.findMany({
    where: { id: { in: ids } },
    include: {
      user: { select: { fullName: true, email: true, vatNumber: true, isCompany: true, vatValidatedAt: true } },
      payment: { select: PAYMENT_LEDGER_SELECT },
      _count: { select: { items: true } },
    },
  });
  return rows.map((row) => ({
    ...row,
    sourceType: "ORDER",
    customerInvoiceEligible: hasInvoiceableVatIdentity(row.user),
    ...deriveRefundFields(row.payment),
  }));
}

async function hydrateWorkshops(ids) {
  if (ids.length === 0) return [];
  const rows = await prisma.workshopReservation.findMany({
    where: { id: { in: ids } },
    include: {
      customer: { select: { fullName: true, email: true, vatNumber: true, isCompany: true, vatValidatedAt: true } },
      payment: { select: PAYMENT_LEDGER_SELECT },
      session: { select: { startDate: true, workshop: { select: { title: true, type: true } } } },
    },
  });
  return rows.map((row) => ({
    ...row,
    sourceType: "WORKSHOP",
    customerInvoiceEligible: hasInvoiceableVatIdentity(row.customer),
    ...deriveRefundFields(row.payment),
  }));
}

async function hydrateFormations(ids) {
  if (ids.length === 0) return [];
  const rows = await prisma.formationReservation.findMany({
    where: { id: { in: ids } },
    include: {
      customer: { select: { fullName: true, email: true, vatNumber: true, isCompany: true, vatValidatedAt: true } },
      payment: { select: PAYMENT_LEDGER_SELECT },
      session: { select: { startDate: true, formation: { select: { title: true, type: true } } } },
    },
  });
  return rows.map((row) => ({
    ...row,
    sourceType: "FORMATION",
    customerInvoiceEligible: hasInvoiceableVatIdentity(row.customer),
    ...deriveRefundFields(row.payment),
  }));
}

// Unchanged from the pre-unification Transactions-tab query — appointments
// stay event-grained, one row per Transaction, exactly as before.
async function hydrateAppointmentTransactions(ids) {
  if (ids.length === 0) return [];
  const rows = await prisma.transaction.findMany({
    where: { id: { in: ids } },
    include: {
      creditNote: { select: { id: true, number: true, totalInclVat: true, emailSentAt: true, billitSentAt: true } },
      payment: {
        select: {
          id: true,
          status: true,
          paymentType: true,
          invoice: {
            select: {
              id: true,
              number: true,
              totalInclVat: true,
              emailSentAt: true,
              billitSentAt: true,
              customerType: true,
              customerVatNumber: true,
              creditNotes: {
                orderBy: { issuedAt: "asc" },
                select: { id: true, number: true, totalInclVat: true, emailSentAt: true, billitSentAt: true },
              },
            },
          },
          transactions: { select: { amount: true, transactionType: true, isDeleted: true } },
          appointment: { select: { id: true, date: true, user: { select: { fullName: true, email: true, vatNumber: true, isCompany: true, vatValidatedAt: true } } } },
        },
      },
    },
  });
  return rows.map((row) => {
    const refundState = summarizeRefundState({
      transactions: row.payment?.transactions ?? [],
      invoice: row.payment?.invoice ?? null,
    });
    return {
      ...row,
      sourceType: "APPOINTMENT",
      customerInvoiceEligible: hasInvoiceableVatIdentity(resolveTransactionCustomer(row.payment)),
      refundState: {
        remainingRefundable: refundState.remainingRefundable,
        fullyRefunded: refundState.fullyRefunded,
        inconsistencies: refundState.inconsistencies,
      },
    };
  });
}

/**
 * Paginated, admin-only operational ledger — one unified, entity-grained
 * list (an order or a booking is one row regardless of how many payment
 * events it has) instead of four separately-queried tabs. "Commandes /
 * Ateliers & événements / Formations" are presets (OPERATION_PRESETS) that
 * restrict `sourceTypes` on this SAME query, not separate queries — so
 * nothing shown there can go missing just because it hasn't been paid yet
 * (an entity-grained row exists independent of whether any Transaction has
 * been written against it).
 *
 * Appointments are the one exception, deliberately kept out of the
 * entity-grained merge (they already have their own dashboard flows) — they
 * keep appearing, event-grained, only under the unrestricted "transactions"
 * preset, exactly as before unification.
 */
export async function getAdminOperations(params = {}) {
  if (!(await requireAdminOperationsAccess())) {
    return { success: false, message: "Non autorisé.", data: [], totalCount: 0, page: 1, pageSize: PAGE_SIZE };
  }

  const { tab, page, type, lifecycleStatus, paymentEvent } = normalizeParams(params);
  const skip = (page - 1) * PAGE_SIZE;
  const sourceTypes = OPERATION_PRESETS[tab]?.sourceTypes ?? null;

  try {
    const { ids: idRows, totalCount } = await listUnifiedOperationIds({
      sourceTypes,
      type,
      lifecycleStatus,
      paymentEvent,
      skip,
      take: PAGE_SIZE,
    });

    const idsBySource = { ORDER: [], WORKSHOP: [], FORMATION: [], APPOINTMENT: [] };
    for (const row of idRows) idsBySource[row.sourceType]?.push(row.id);

    const [orders, workshops, formations, appointments] = await Promise.all([
      hydrateOrders(idsBySource.ORDER),
      hydrateWorkshops(idsBySource.WORKSHOP),
      hydrateFormations(idsBySource.FORMATION),
      hydrateAppointmentTransactions(idsBySource.APPOINTMENT),
    ]);

    const byId = new Map();
    for (const row of [...orders, ...workshops, ...formations, ...appointments]) byId.set(row.id, row);
    // Stage A already sorted by sortAt DESC; findMany({ id: { in } }) does
    // not preserve that order, so the final list is rebuilt from it here.
    const data = idRows.map((row) => byId.get(row.id)).filter(Boolean);

    return {
      success: true,
      tab,
      page,
      type,
      lifecycleStatus,
      paymentEvent,
      pageSize: PAGE_SIZE,
      totalCount,
      data: serializeDecimalFields(data),
    };
  } catch (error) {
    console.error("[getAdminOperations]", error);
    return {
      success: false,
      tab,
      page,
      type,
      lifecycleStatus,
      paymentEvent,
      pageSize: PAGE_SIZE,
      totalCount: 0,
      data: [],
      message: "Impossible de charger les opérations.",
    };
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
        settledRefundLeg: {
          select: {
            refundOperation: {
              select: { id: true, status: true, customerNotifiedAt: true, creditNote: { select: { id: true, number: true, emailSentAt: true, billitSentAt: true } } },
            },
          },
        },
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
                customerType: true,
                customerVatNumber: true,
                customerName: true,
                // Enough to compute fullyCredited via summarizeRefundState
                // below — not the individual notes themselves, which the
                // drawer never lists (it shows only this row's own
                // creditNote, per the comment above).
                creditNotes: { select: { id: true, totalInclVat: true } },
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

    // Drives the drawer's "Annuler et rembourser" gate — same formula
    // InvoiceRowActions uses for the Transactions-tab row, computed here via
    // the canonical helper instead of re-deriving it ad hoc client-side.
    const refundState = summarizeRefundState({
      transactions: transaction.payment?.transactions ?? [],
      invoice: transaction.payment?.invoice ?? null,
    });

    return {
      success: true,
      data: serializeDecimalFields({
        ...transaction,
        refundState: {
          remainingRefundable: refundState.remainingRefundable,
          fullyCredited: refundState.fullyCredited,
        },
      }),
    };
  } catch (error) {
    console.error("[getTransactionDetail]", error);
    return { success: false, message: "Impossible de charger le détail de cette transaction." };
  }
}

/**
 * `issueCreditNoteForTransaction` used to live here.
 *
 * It issued a legally numbered credit note against an invoice and did
 * nothing else — no cancellation, no refund, no released seat. The audit in
 * scripts/audit-refund-states.mjs found nine payments left in exactly that
 * state on the dev database: fully credited on paper, with every euro still
 * sitting in the account.
 *
 * The handoff removes that capability outright ("le bouton ne doit plus
 * pouvoir créer une note de crédit isolée sans annulation ni
 * remboursement"). Its two legitimate uses moved to
 * actions/dashboard/cancel-and-refund.js:
 *
 *   - unwinding a sale                     -> cancelAndRefund()
 *   - documenting an already-made refund   -> issueMissingRefundDocument()
 *
 * The second refuses unless a REFUND transaction is already on the ledger,
 * which is precisely the guard the old action never had.
 */
