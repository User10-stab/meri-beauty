"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  isAdminRole,
  canSendTicketEmail as canSendTicketEmailOperator,
} from "@/lib/authorization";
import { resolveSalonScope } from "@/lib/authorization/salon-scope";
import { listIndependentPayeeStaffIds } from "@/lib/payments/resolve-payee";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import {
  TYPE_FILTERS,
  PAYMENT_EVENT_FILTERS,
  LIFECYCLE_STATUS_FILTERS,
  OPERATION_PRESETS,
} from "@/lib/dashboard/operation-filters";
import { hasInvoiceableVatIdentity } from "@/lib/tax-policy";
import { summarizeRefundState } from "@/lib/refunds/plan-refund";
import { AUDIT_ACTIONS } from "@/lib/audit-log";
import { checkInQrDataUrl, pickupQrDataUrl } from "@/lib/qrcode";

const ADMIN_OPERATION_TABS = Object.freeze(["transactions", "orders", "workshops", "formations"]);
const PAGE_SIZE = 30;

/**
 * A FormationSession's Animator is only a real staff/admin account when its
 * e-mail matches one — resolveFormationAnimatorId() (actions/formations/
 * create-formation.js) keeps that in lockstep for any formation assigned
 * through the formation form's staff picker. Batched (one query for however
 * many distinct e-mails a page of rows carries) rather than per-row.
 */
async function resolveStaffByEmails(emails) {
  const distinct = [...new Set(emails.filter(Boolean))];
  if (distinct.length === 0) return new Map();
  const staffUsers = await prisma.user.findMany({
    where: { email: { in: distinct }, role: "STAFF" },
    select: { email: true, fullName: true, role: true },
  });
  return new Map(staffUsers.map((u) => [u.email, { name: u.fullName, role: u.role }]));
}

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
  // No `staffId` here, on purpose: whose ledger is read is decided by the
  // session alone (see getAdminOperations), never by the query string.
  return { tab, page, type, lifecycleStatus, paymentEvent };
}

/**
 * Who this ledger is being read for, resolved ONCE before the UNION arms are
 * built — attribution has to travel down into the SQL. Doing it during
 * hydration instead would leave `totalCount` and the pagination counting rows
 * the reader never sees: page 2 of a 4-row result, and a "30 éléments" header
 * over an empty table.
 *
 * Two modes:
 *
 *   SALON (the default) — the salon's own activity. Money rows (appointments,
 *   atelier and formation seats) are the salon's when their Payment's frozen
 *   owner is (`Payment.payeeStaffId` null, see lib/payments/resolve-payee.js);
 *   a seat not paid yet follows its session's animator. Orders and audit rows
 *   follow who rang them up: the ADMIN/OWNER accounts plus Marie Mercier
 *   (resolveSalonScope), and rows nobody stamped.
 *
 *   STAFF — a practitioner reading her OWN ledger on /dashboard/mes-operations.
 *   Only ever the session's own Staff row. There is no way to pick one: every
 *   practitioner is legally independent, and the salon has no right to read
 *   her takings. The same owner test, pointed at her: her appointments, and
 *   the atelier/formation seats of sessions she animates.
 *
 * @returns {Promise<null|{ mode: string, staffId: string, staffName: string|null,
 *   userIds: string[], independentStaffIds: string[], includeUnattributed: boolean }>}
 *   null when `staffId` names nobody.
 */
async function resolveOperationsScope(staffId) {
  if (!staffId) {
    const [{ salonUserIds }, independentStaffIds] = await Promise.all([
      resolveSalonScope(prisma),
      listIndependentPayeeStaffIds(prisma),
    ]);
    return {
      mode: "SALON",
      staffId: "",
      staffName: null,
      userIds: salonUserIds,
      independentStaffIds,
      includeUnattributed: true,
    };
  }

  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: { id: true, isDeleted: true, user: { select: { id: true, fullName: true } } },
  });
  // An unknown or deleted id must not silently widen the ledger back to the
  // whole salon — the caller turns this into an error, not a default.
  if (!staff || staff.isDeleted) return null;

  return {
    mode: "STAFF",
    staffId: staff.id,
    staffName: staff.user.fullName,
    userIds: [staff.user.id],
    independentStaffIds: [],
    includeUnattributed: false,
  };
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

async function listUnifiedOperationIds({ scope, sourceTypes, type, lifecycleStatus, paymentEvent, skip, take }) {
  // Attribution lives HERE, in the arms, and nowhere else. Postgres has no
  // empty `IN ()` — it is a syntax error, not a match-nothing — so every
  // list below is guarded before it is injected, and an empty scope becomes
  // an explicit `false` rather than a 500.
  const ownedBy = (column, ids) =>
    ids.length === 0
      ? Prisma.sql`AND false`
      : scope.includeUnattributed
      ? Prisma.sql`AND (${column} IN (${Prisma.join(ids)}) OR ${column} IS NULL)`
      : Prisma.sql`AND ${column} IN (${Prisma.join(ids)})`;

  // An Order is stamped with a User.id (Order.createdByStaffId → User), an
  // Appointment with a Staff.id (the denormalized, indexed Appointment.staffId
  // — never the three-hop join through StaffService). The two id spaces are
  // not interchangeable: crossing them matches nothing, silently.
  const orderScope = ownedBy(Prisma.sql`o."createdByStaffId"`, scope.userIds);

  // Money rows follow the Payment's frozen owner (Payment.payeeStaffId, null =
  // the salon) — never who clicked. See lib/payments/resolve-payee.js.
  const paymentOwned = (alias) =>
    scope.mode === "STAFF"
      ? Prisma.sql`${Prisma.raw(alias)}."payeeStaffId" = ${scope.staffId}`
      : Prisma.sql`${Prisma.raw(alias)}."payeeStaffId" IS NULL`;
  // A seat with no Payment yet has no frozen owner: it follows the session's
  // animator (or the catalogue's), the same rule resolve-payee applies when
  // the payment is eventually created.
  const animatorOwned = (expr) =>
    scope.mode === "STAFF"
      ? Prisma.sql`${expr} = ${scope.staffId}`
      : scope.independentStaffIds.length === 0
        ? Prisma.sql`true`
        : Prisma.sql`(${expr} IS NULL OR ${expr} NOT IN (${Prisma.join(scope.independentStaffIds)}))`;
  const reservationScope = (paymentColumn, rowId) => {
    const animator = Prisma.sql`COALESCE(sa."staffId", ca."staffId")`;
    return Prisma.sql`AND (
      EXISTS (SELECT 1 FROM "Payment" po WHERE po.${Prisma.raw(paymentColumn)} = ${Prisma.raw(rowId)} AND ${paymentOwned("po")})
      OR (
        NOT EXISTS (SELECT 1 FROM "Payment" po WHERE po.${Prisma.raw(paymentColumn)} = ${Prisma.raw(rowId)})
        AND ${animatorOwned(animator)}
      )
    )`;
  };
  const workshopScope = reservationScope('"workshopReservationId"', "wr.id");
  const formationScope = reservationScope('"formationReservationId"', "fr.id");
  const workshopAnimatorJoins = Prisma.sql`
      LEFT JOIN "animators" sa ON sa.id = ws."animatorId"
      LEFT JOIN "animators" ca ON ca.id = w."animatorId"`;
  const formationAnimatorJoins = Prisma.sql`
      LEFT JOIN "animators" sa ON sa.id = fs."animatorId"
      LEFT JOIN "animators" ca ON ca.id = f."animatorId"`;
  // Adjustments and transfers are audit rows, and an audit row already knows
  // who did it — the cheapest honest attribution on this screen.
  const actorScope = ownedBy(Prisma.sql`al."actorId"`, scope.userIds);

  const includeOrders = !sourceTypes || sourceTypes.includes("ORDER");
  const includeWorkshops = !sourceTypes || sourceTypes.includes("WORKSHOP");
  const includeFormations = !sourceTypes || sourceTypes.includes("FORMATION");
  // Appointments are only ever reachable from the unrestricted (transactions)
  // preset — Commandes/Ateliers/Formations never showed them before either.
  const includeAppointments = !sourceTypes;
  // A price adjustment is a business event with no Transaction behind it when
  // nothing was left to collect — writing off the balance on a booking that
  // had already paid a deposit, say. Every other arm of this union is anchored
  // to money, so that event was invisible here and lived only in the audit
  // log. It is money the salon decided not to take, which is exactly the kind
  // of thing Opérations exists to show.
  //
  // Excluded whenever a *payment* filter is applied, because an adjustment is
  // not a payment event and would otherwise appear under "Acompte" or
  // "Solde"; and whenever a lifecycle filter is applied, because the audit row
  // carries no lifecycle of its own. Both exclusions keep the filters honest
  // rather than quietly widening what they mean.
  const includeAdjustments = !sourceTypes && lifecycleStatus === "ALL" && paymentEvent === "ALL";
  // A transfer is an operational event, not money movement. Show it in the
  // unrestricted ledger and in the Ateliers & événements / Formations
  // presets, while excluding it from payment-event filters so it can never
  // be mistaken for a deposit, balance payment or refund.
  // Staff rent (« Loyer staff »): the salon's own income, once « Accepter »
  // records the transfer (or a credit note records its refund). Event-grained
  // like appointments — one row per payment event — and only in the salon's
  // unrestricted ledger: a rent has no lifecycle status to filter on, and an
  // independent's own ledger never shows what she pays the salon.
  const includeStaffRent = !sourceTypes && lifecycleStatus === "ALL" && scope.mode !== "STAFF";
  const includeWorkshopTransfers =
    (!sourceTypes || sourceTypes.includes("WORKSHOP")) && paymentEvent === "ALL";
  const includeFormationTransfers =
    (!sourceTypes || sourceTypes.includes("FORMATION")) && paymentEvent === "ALL";

  const arms = [];

  if (includeOrders) {
    arms.push(Prisma.sql`
      SELECT o.id AS id, 'ORDER' AS "sourceType", GREATEST(o."createdAt", (
        SELECT MAX(t."paidAt") FROM "Payment" p JOIN "Transaction" t ON t."paymentId" = p.id
        WHERE p."orderId" = o.id AND t."isDeleted" = false
      )) AS "sortAt"
      FROM "Order" o
      WHERE 1=1
        ${orderScope}
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
      SELECT wr.id AS id, 'WORKSHOP' AS "sourceType", GREATEST(wr."createdAt", (
        SELECT MAX(t."paidAt") FROM "Payment" p JOIN "Transaction" t ON t."paymentId" = p.id
        WHERE p."workshopReservationId" = wr.id AND t."isDeleted" = false
      )) AS "sortAt"
      FROM "workshop_reservations" wr
      JOIN "workshop_sessions" ws ON ws.id = wr."sessionId"
      JOIN "workshops" w ON w.id = ws."workshopId"
      ${workshopAnimatorJoins}
      WHERE 1=1
        ${workshopScope}
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
      SELECT fr.id AS id, 'FORMATION' AS "sourceType", GREATEST(fr."createdAt", (
        SELECT MAX(t."paidAt") FROM "Payment" p JOIN "Transaction" t ON t."paymentId" = p.id
        WHERE p."formationReservationId" = fr.id AND t."isDeleted" = false
      )) AS "sortAt"
      FROM "formation_reservations" fr
      JOIN "formation_sessions" fs ON fs.id = fr."sessionId"
      JOIN "formations" f ON f.id = fs."formationId"
      ${formationAnimatorJoins}
      WHERE 1=1
        ${formationScope}
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
    // Keep every payment event, including deposits after final settlement.
    // Lifecycle filters apply to the linked appointment.
    arms.push(Prisma.sql`
      SELECT t.id AS id, 'APPOINTMENT' AS "sourceType", t."paidAt" AS "sortAt"
      FROM "Transaction" t
      JOIN "Payment" p ON p.id = t."paymentId"
      JOIN "Appointment" a ON a.id = p."appointmentId"
      WHERE t."isDeleted" = false
        AND p."appointmentId" IS NOT NULL
        AND ${paymentOwned("p")}
        ${lifecycleStatus !== "ALL" ? Prisma.sql`AND a."status"::text = ${lifecycleStatus}` : Prisma.empty}
        ${paymentEvent !== "ALL" ? Prisma.sql`AND t."transactionType"::text = ${paymentEvent}` : Prisma.empty}
    `);
  }

  if (includeStaffRent) {
    arms.push(Prisma.sql`
      SELECT t.id AS id, 'STAFF_RENT' AS "sourceType", t."paidAt" AS "sortAt"
      FROM "Transaction" t
      JOIN "Payment" p ON p.id = t."paymentId"
      WHERE t."isDeleted" = false
        AND p."staffContractId" IS NOT NULL
        AND p."payeeStaffId" IS NULL
        ${paymentEvent !== "ALL" ? Prisma.sql`AND t."transactionType"::text = ${paymentEvent}` : Prisma.empty}
    `);
  }

  if (includeAdjustments) {
    arms.push(Prisma.sql`
      SELECT al.id AS id, 'ADJUSTMENT' AS "sourceType", al."createdAt" AS "sortAt"
      FROM "AuditLog" al
      WHERE al."action" = ${AUDIT_ACTIONS.RESERVATION_PRICE_ADJUSTED}
        ${actorScope}
    `);
  }

  if (includeWorkshopTransfers) {
    arms.push(Prisma.sql`
      SELECT al.id AS id, 'TRANSFER' AS "sourceType", al."createdAt" AS "sortAt"
      FROM "AuditLog" al
      JOIN "workshop_reservations" wr ON wr.id = al."entityId"
      JOIN "workshop_sessions" ws ON ws.id = wr."sessionId"
      JOIN "workshops" w ON w.id = ws."workshopId"
      ${workshopAnimatorJoins}
      WHERE al."action" = ${AUDIT_ACTIONS.RESERVATION_SESSION_TRANSFERRED}
        AND al."entityType" = 'WorkshopReservation'
        ${workshopScope}
        ${lifecycleStatus !== "ALL" ? Prisma.sql`AND wr."status"::text = ${lifecycleStatus}` : Prisma.empty}
        ${type !== "ALL" ? Prisma.sql`AND w."type"::text = ${type}` : Prisma.empty}
    `);
  }

  if (includeFormationTransfers) {
    arms.push(Prisma.sql`
      SELECT al.id AS id, 'TRANSFER' AS "sourceType", al."createdAt" AS "sortAt"
      FROM "AuditLog" al
      JOIN "formation_reservations" fr ON fr.id = al."entityId"
      JOIN "formation_sessions" fs ON fs.id = fr."sessionId"
      JOIN "formations" f ON f.id = fs."formationId"
      ${formationAnimatorJoins}
      WHERE al."action" = ${AUDIT_ACTIONS.RESERVATION_SESSION_TRANSFERRED}
        AND al."entityType" = 'FormationReservation'
        ${formationScope}
        ${lifecycleStatus !== "ALL" ? Prisma.sql`AND fr."status"::text = ${lifecycleStatus}` : Prisma.empty}
        ${type !== "ALL" ? Prisma.sql`AND f."type"::text = ${type}` : Prisma.empty}
    `);
  }

  if (arms.length === 0) return { ids: [], totalCount: 0 };

  const unioned = Prisma.join(arms, " UNION ALL ");

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT id, "sourceType" FROM (${unioned}) AS combined
      ORDER BY "sortAt" DESC, "sourceType", id
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
    // A cancellation already open on this payment: a second one cannot be
    // created, only resumed, so the row must stop offering it.
    refundInFlight: (payment?.refundOperations ?? []).length > 0,
    latestTransactionId: latest?.id ?? null,
    latestTransactionType: latest?.transactionType ?? null,
    latestTransactionAt: latest?.paidAt ?? null,
  };
}

const PAYMENT_LEDGER_SELECT = Object.freeze({
  id: true,
  status: true,
  paidAmount: true,
  remainingAmount: true,
  transactions: { orderBy: [{ paidAt: "asc" }, { id: "asc" }], select: { id: true, amount: true, method: true, manualReference: true, transactionType: true, isDeleted: true, paidAt: true } },
  invoice: {
    select: {
      id: true,
      number: true,
      totalInclVat: true,
      emailSentAt: true,
      peppyrusSentAt: true,
      customerType: true,
      customerVatNumber: true,
      // Lets the delivery dialog show the client's own address next to the
      // "envoyer aussi au client" toggle (the send action reads it from the
      // DB regardless).
      customerName: true,
      customerEmail: true,
      creditNotes: { select: { id: true, number: true, totalInclVat: true, emailSentAt: true, peppyrusSentAt: true } },
    },
  },
  // Same in-flight guard getTransactionDetail selects — see its comment.
  // Carried on the list row too so the row's own cancel affordance can never
  // disagree with the drawer's about whether this sale is already spent.
  refundOperations: {
    where: { status: { in: ["PENDING", "PARTIALLY_REFUNDED"] } },
    select: { id: true },
  },
});

/**
 * Cross-links a Workshop/Formation row to its most recent transfer, so the
 * row that shows "what this reservation looks like now" can point at "why it
 * changed" instead of leaving that as a second, seemingly unrelated row in
 * the ledger. One batched query per hydrator call, not per row.
 */
async function attachLastTransfer(rows, entityType) {
  if (rows.length === 0) return rows;
  const logs = await prisma.auditLog.findMany({
    where: { action: AUDIT_ACTIONS.RESERVATION_SESSION_TRANSFERRED, entityType, entityId: { in: rows.map((row) => row.id) } },
    select: { id: true, entityId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const latestByEntity = new Map();
  for (const log of logs) {
    // Ordered desc, so the first one seen per entity is the most recent —
    // only that one is worth surfacing on the row.
    if (!latestByEntity.has(log.entityId)) latestByEntity.set(log.entityId, log);
  }
  return rows.map((row) => {
    const log = latestByEntity.get(row.id);
    return { ...row, lastTransferLogId: log?.id ?? null, lastTransferredAt: log?.createdAt ?? null };
  });
}

async function hydrateOrders(ids) {
  if (ids.length === 0) return [];
  const rows = await prisma.order.findMany({
    where: { id: { in: ids } },
    include: {
      user: { select: { fullName: true, email: true, vatNumber: true, isCompany: true, vatValidatedAt: true } },
      payment: { select: PAYMENT_LEDGER_SELECT },
      _count: { select: { items: true } },
      // null (not undefined) is a genuine, deliberate answer here: a
      // customer's own online/pickup order has no staff involved at all.
      createdByStaff: { select: { fullName: true, role: true } },
      // SETTLED_AT_COUNTER: the sale that replaced the order, and on that
      // sale the order it came from — so neither row reads as unexplained.
      settledBySale: { select: { id: true, orderNumber: true } },
      settledOrder: { select: { id: true, orderNumber: true } },
    },
  });
  return rows.map((row) => ({
    ...row,
    sourceType: "ORDER",
    customerInvoiceEligible: hasInvoiceableVatIdentity(row.user),
    performedBy: row.createdByStaff ? { name: row.createdByStaff.fullName, role: row.createdByStaff.role } : null,
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
      session: { select: { startDate: true, workshop: { select: { title: true, type: true } }, animator: { select: { name: true, email: true } } } },
    },
  });
  const staffByEmail = await resolveStaffByEmails(rows.map((row) => row.session?.animator?.email));
  const mapped = rows.map((row) => {
    const animator = row.session?.animator;
    // Same bridge as hydrateFormations: a match means the animator IS a real
    // staff account; otherwise fall back to the Animator's own name,
    // unbadged, since it may be an outside instructor never assigned via the
    // staff picker at all.
    const performedBy = animator ? staffByEmail.get(animator.email) ?? { name: animator.name, role: null } : null;
    return {
      ...row,
      sourceType: "WORKSHOP",
      customerInvoiceEligible: hasInvoiceableVatIdentity(row.customer),
      performedBy,
      ...deriveRefundFields(row.payment),
    };
  });
  return attachLastTransfer(mapped, "WorkshopReservation");
}

async function hydrateFormations(ids) {
  if (ids.length === 0) return [];
  const rows = await prisma.formationReservation.findMany({
    where: { id: { in: ids } },
    include: {
      customer: { select: { fullName: true, email: true, vatNumber: true, isCompany: true, vatValidatedAt: true } },
      payment: { select: PAYMENT_LEDGER_SELECT },
      session: { select: { startDate: true, formation: { select: { title: true, type: true } }, animator: { select: { name: true, email: true } } } },
    },
  });
  const staffByEmail = await resolveStaffByEmails(rows.map((row) => row.session?.animator?.email));
  const mapped = rows.map((row) => {
    const animator = row.session?.animator;
    // A match means the animator IS a real staff account (see
    // resolveStaffByEmails' doc comment); otherwise fall back to the
    // Animator's own name, unbadged, since it may be an outside instructor
    // this formation was never assigned to via the staff picker at all.
    const performedBy = animator ? staffByEmail.get(animator.email) ?? { name: animator.name, role: null } : null;
    return {
      ...row,
      sourceType: "FORMATION",
      customerInvoiceEligible: hasInvoiceableVatIdentity(row.customer),
      performedBy,
      ...deriveRefundFields(row.payment),
    };
  });
  return attachLastTransfer(mapped, "FormationReservation");
}

// Unchanged from the pre-unification Transactions-tab query — appointments
// stay event-grained, one row per Transaction, exactly as before.
async function hydrateAppointmentTransactions(ids) {
  if (ids.length === 0) return [];
  const rows = await prisma.transaction.findMany({
    where: { id: { in: ids } },
    include: {
      creditNote: { select: { id: true, number: true, totalInclVat: true, emailSentAt: true, peppyrusSentAt: true } },
      payment: {
        select: {
          id: true,
          status: true,
          paymentType: true,
          paidAmount: true,
          remainingAmount: true,
          invoice: {
            select: {
              id: true,
              number: true,
              totalInclVat: true,
              emailSentAt: true,
              peppyrusSentAt: true,
              customerType: true,
              customerVatNumber: true,
              customerName: true,
              customerEmail: true,
              creditNotes: {
                orderBy: { issuedAt: "asc" },
                select: { id: true, number: true, totalInclVat: true, emailSentAt: true, peppyrusSentAt: true },
              },
            },
          },
          transactions: { orderBy: [{ paidAt: "asc" }, { id: "asc" }], select: { id: true, amount: true, method: true, manualReference: true, paidAt: true, transactionType: true, isDeleted: true } },
          appointment: {
            select: {
              id: true,
              status: true,
              date: true,
              user: { select: { fullName: true, email: true, vatNumber: true, isCompany: true, vatValidatedAt: true } },
              staffService: { select: { staff: { select: { user: { select: { fullName: true, role: true } } } } } },
            },
          },
        },
      },
    },
  });
  return rows.map((row) => {
    const refundState = summarizeRefundState({
      transactions: row.payment?.transactions ?? [],
      invoice: row.payment?.invoice ?? null,
    });
    const staffUser = row.payment?.appointment?.staffService?.staff?.user;
    return {
      ...row,
      sourceType: "APPOINTMENT",
      customerInvoiceEligible: hasInvoiceableVatIdentity(resolveTransactionCustomer(row.payment)),
      performedBy: staffUser ? { name: staffUser.fullName, role: staffUser.role } : null,
      refundState: {
        remainingRefundable: refundState.remainingRefundable,
        fullyRefunded: refundState.fullyRefunded,
        inconsistencies: refundState.inconsistencies,
      },
    };
  });
}

/** One row per staff-rent payment event (received transfer, or refund). */
async function hydrateStaffRentTransactions(ids) {
  if (ids.length === 0) return [];
  const rows = await prisma.transaction.findMany({
    where: { id: { in: ids } },
    include: {
      payment: {
        select: {
          id: true,
          status: true,
          paymentType: true,
          paidAmount: true,
          remainingAmount: true,
          invoice: {
            select: {
              id: true,
              number: true,
              dueDate: true,
              totalInclVat: true,
              emailSentAt: true,
              peppyrusSentAt: true,
              customerType: true,
              customerVatNumber: true,
              customerName: true,
              customerEmail: true,
              creditNotes: {
                orderBy: { issuedAt: "asc" },
                select: { id: true, number: true, totalInclVat: true, emailSentAt: true, peppyrusSentAt: true },
              },
            },
          },
          transactions: { orderBy: [{ paidAt: "asc" }, { id: "asc" }], select: { id: true, amount: true, method: true, manualReference: true, paidAt: true, transactionType: true, isDeleted: true } },
          staffContract: { select: { staff: { select: { user: { select: { fullName: true, email: true, vatNumber: true } } } } } },
        },
      },
    },
  });
  return rows.map((row) => ({
    ...row,
    sourceType: "STAFF_RENT",
    staffMember: row.payment?.staffContract?.staff?.user ?? null,
    // Its invoice is issued by the billing job, before payment: never "à émettre".
    customerInvoiceEligible: false,
  }));
}

/**
 * Price adjustments, resolved back to the booking they changed.
 *
 * The audit row carries the numbers (before/after, reason, actor); the
 * booking supplies the customer and the title. Three entity types share one
 * action, so they are fetched per type and merged — a JOIN is impossible
 * because AuditLog.entityId is polymorphic and untyped by design.
 *
 * Every field the table reads is filled in, including the ones an adjustment
 * has no answer for (payment, refundState). Leaving them undefined would make
 * paymentSummary and the "Voir / gérer" gate read them off a row shape they
 * were never written for.
 */
async function hydrateAdjustments(ids) {
  if (ids.length === 0) return [];

  const logs = await prisma.auditLog.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      createdAt: true,
      entityType: true,
      entityId: true,
      before: true,
      after: true,
      metadata: true,
      actor: { select: { fullName: true } },
      actorRole: true,
    },
  });

  const idsFor = (type) => logs.filter((l) => l.entityType === type).map((l) => l.entityId);

  const [appointments, workshops, formations] = await Promise.all([
    prisma.appointment.findMany({
      where: { id: { in: idsFor("Appointment") } },
      select: {
        id: true,
        status: true,
        user: { select: { fullName: true, email: true } },
        staffService: { select: { service: { select: { name: true } } } },
      },
    }),
    prisma.workshopReservation.findMany({
      where: { id: { in: idsFor("WorkshopReservation") } },
      select: {
        id: true,
        status: true,
        customer: { select: { fullName: true, email: true } },
        session: { select: { workshop: { select: { title: true, type: true } } } },
      },
    }),
    prisma.formationReservation.findMany({
      where: { id: { in: idsFor("FormationReservation") } },
      select: {
        id: true,
        status: true,
        customer: { select: { fullName: true, email: true } },
        session: { select: { formation: { select: { title: true } } } },
      },
    }),
  ]);

  const byEntity = new Map();
  for (const a of appointments) {
    byEntity.set(a.id, {
      title: a.staffService?.service?.name ?? "Prestation",
      kindLabel: "Rendez-vous",
      customer: a.user,
      status: a.status,
    });
  }
  for (const w of workshops) {
    byEntity.set(w.id, {
      title: w.session?.workshop?.title ?? "Atelier",
      kindLabel: w.session?.workshop?.type === "EVENT" ? "Événement" : "Atelier",
      customer: w.customer,
      status: w.status,
    });
  }
  for (const f of formations) {
    byEntity.set(f.id, {
      title: f.session?.formation?.title ?? "Formation",
      kindLabel: "Formation",
      customer: f.customer,
      status: f.status,
    });
  }

  return logs.map((log) => {
    const booking = byEntity.get(log.entityId) ?? null;
    const previousTotal = Number(log.before?.totalAmount ?? 0);
    const finalTotal = Number(log.after?.totalAmount ?? 0);
    return {
      id: log.id,
      sourceType: "ADJUSTMENT",
      adjustedAt: log.createdAt,
      // Signed: negative is revenue the salon chose not to take. That is not
      // a refund — no money leaves — and the table must not style it as one.
      delta: Math.round((finalTotal - previousTotal) * 100) / 100,
      previousTotal,
      finalTotal,
      reason: log.metadata?.reason ?? null,
      actorName: log.actor?.fullName ?? null,
      actorRole: log.actorRole ?? null,
      entityType: log.entityType,
      entityId: log.entityId,
      bookingTitle: booking?.title ?? "—",
      bookingKind: booking?.kindLabel ?? "Réservation",
      customer: booking?.customer ?? null,
      status: booking?.status ?? null,
      // Deliberately inert: an adjustment opens no drawer and settles nothing.
      payment: null,
      latestTransactionId: null,
      latestTransactionType: null,
      refundState: { totalCollected: 0, totalRefunded: 0, remainingRefundable: 0, fullyCredited: false },
      customerInvoiceEligible: false,
    };
  });
}

/**
 * Administrative workshop/event and formation transfers. The audit row is
 * the immutable history; the reservation supplies its current customer,
 * lifecycle and payment position. This deliberately creates no Transaction
 * and exposes no invoice/refund action from the transfer row. Split by
 * entityType using the same idsFor/Promise.all/Map pattern as
 * hydrateAdjustments above, since a transfer can now be either kind.
 */
async function hydrateTransfers(ids) {
  if (ids.length === 0) return [];

  const logs = await prisma.auditLog.findMany({
    where: { id: { in: ids }, action: AUDIT_ACTIONS.RESERVATION_SESSION_TRANSFERRED },
    select: {
      id: true,
      createdAt: true,
      entityType: true,
      entityId: true,
      before: true,
      after: true,
      metadata: true,
      actor: { select: { fullName: true } },
      actorRole: true,
    },
  });

  const idsFor = (type) => logs.filter((l) => l.entityType === type).map((l) => l.entityId);

  const [workshopReservations, formationReservations] = await Promise.all([
    prisma.workshopReservation.findMany({
      where: { id: { in: idsFor("WorkshopReservation") } },
      include: {
        customer: { select: { fullName: true, email: true, vatNumber: true, isCompany: true, vatValidatedAt: true } },
        payment: { select: PAYMENT_LEDGER_SELECT },
        session: { select: { startDate: true, workshop: { select: { title: true, type: true } } } },
      },
    }),
    prisma.formationReservation.findMany({
      where: { id: { in: idsFor("FormationReservation") } },
      include: {
        customer: { select: { fullName: true, email: true, vatNumber: true, isCompany: true, vatValidatedAt: true } },
        payment: { select: PAYMENT_LEDGER_SELECT },
        session: { select: { startDate: true, formation: { select: { title: true } } } },
      },
    }),
  ]);
  const reservationById = new Map();
  for (const r of workshopReservations) reservationById.set(r.id, { ...r, activityTitle: r.session?.workshop?.title });
  for (const r of formationReservations) reservationById.set(r.id, { ...r, activityTitle: r.session?.formation?.title });

  const workshopSessionIds = [
    ...new Set(
      logs.filter((l) => l.entityType === "WorkshopReservation").flatMap((log) => [log.before?.sessionId, log.after?.sessionId]).filter(Boolean)
    ),
  ];
  const formationSessionIds = [
    ...new Set(
      logs.filter((l) => l.entityType === "FormationReservation").flatMap((log) => [log.before?.sessionId, log.after?.sessionId]).filter(Boolean)
    ),
  ];
  const [workshopSessions, formationSessions] = await Promise.all([
    prisma.workshopSession.findMany({
      where: { id: { in: workshopSessionIds } },
      select: { id: true, startDate: true, workshop: { select: { title: true } } },
    }),
    prisma.formationSession.findMany({
      where: { id: { in: formationSessionIds } },
      select: { id: true, startDate: true, formation: { select: { title: true } } },
    }),
  ]);
  const sessionById = new Map();
  for (const s of workshopSessions) sessionById.set(s.id, { startDate: s.startDate, title: s.workshop?.title });
  for (const s of formationSessions) sessionById.set(s.id, { startDate: s.startDate, title: s.formation?.title });

  return logs.map((log) => {
    const reservation = reservationById.get(log.entityId) ?? null;
    const previousSession = sessionById.get(log.before?.sessionId) ?? null;
    const targetSession = sessionById.get(log.after?.sessionId) ?? null;
    const paymentFields = deriveRefundFields(reservation?.payment ?? null);
    return {
      id: log.id,
      sourceType: "TRANSFER",
      operationOnly: true,
      transferredAt: log.createdAt,
      entityType: log.entityType,
      entityId: log.entityId,
      previousActivityTitle: log.before?.activityTitle ?? previousSession?.title ?? "Activité précédente",
      newActivityTitle: log.after?.activityTitle ?? targetSession?.title ?? reservation?.activityTitle ?? "Nouvelle activité",
      previousSessionDate: log.before?.sessionStartDate ?? previousSession?.startDate ?? null,
      newSessionDate: log.after?.sessionStartDate ?? targetSession?.startDate ?? reservation?.session?.startDate ?? null,
      previousTotal: Number(log.before?.totalPrice ?? 0),
      finalTotal: Number(log.after?.totalPrice ?? 0),
      balanceDue: Number(log.after?.balanceDue ?? reservation?.balanceDue ?? 0),
      paidAmount: Number(log.metadata?.paidAmount ?? reservation?.payment?.paidAmount ?? 0),
      priceDifference: Number(log.metadata?.priceDifference ?? 0),
      priceDecision: log.metadata?.priceDecision ?? "SAME_PRICE",
      waivedAmount: Number(log.metadata?.waivedAmount ?? 0),
      modificationFee: Number(log.metadata?.modificationFee ?? 0),
      reason: log.metadata?.reason ?? null,
      // Sourced straight from the audit metadata written by
      // changeReservationSession/changeFormationReservationSession — no
      // extra query needed. Null on every transfer that didn't touch an
      // invoice (the common case, and every B2C transfer — see
      // b2c-no-invoice-contracts.test.js).
      invoiceReplacement: log.metadata?.invoiceReplacement ?? null,
      actorName: log.actor?.fullName ?? null,
      actorRole: log.actorRole ?? null,
      status: reservation?.status ?? null,
      customer: reservation?.customer ?? null,
      payment: reservation?.payment ?? null,
      latestTransactionId: null,
      latestTransactionType: null,
      refundState: paymentFields.refundState,
      customerInvoiceEligible: false,
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
  const session = await auth();
  if (!session?.user) {
    return { success: false, message: "Non autorisé.", data: [], totalCount: 0, page: 1, pageSize: PAGE_SIZE };
  }

  const { tab, page, type, lifecycleStatus, paymentEvent } = normalizeParams(params);
  const skip = (page - 1) * PAGE_SIZE;
  const sourceTypes = OPERATION_PRESETS[tab]?.sourceTypes ?? null;

  // Whose ledger is decided by the session alone, server-side — every export
  // of a "use server" module is a public endpoint in its own right, so a
  // `staffId` in the params is ignored rather than trusted:
  //   - an admin always reads the SALON's ledger, never an independent's;
  //   - a practitioner (/dashboard/mes-operations) reads her own and nothing else.
  const isAdmin = isAdminRole(session.user.role);
  let requestedStaffId = "";
  if (!isAdmin) {
    const own = await prisma.staff.findFirst({
      where: { userId: session.user.id, isDeleted: false },
      select: { id: true },
    });
    if (!own) {
      return { success: false, message: "Non autorisé.", data: [], totalCount: 0, page: 1, pageSize: PAGE_SIZE };
    }
    requestedStaffId = own.id;
  }

  const scope = await resolveOperationsScope(requestedStaffId);
  if (!scope) {
    return {
      success: false,
      message: "Membre du personnel introuvable.",
      tab,
      page,
      type,
      lifecycleStatus,
      paymentEvent,
      staffId: requestedStaffId,
      pageSize: PAGE_SIZE,
      totalCount: 0,
      data: [],
    };
  }

  try {
    const { ids: idRows, totalCount } = await listUnifiedOperationIds({
      scope,
      sourceTypes,
      type,
      lifecycleStatus,
      paymentEvent,
      skip,
      take: PAGE_SIZE,
    });

    const idsBySource = { ORDER: [], WORKSHOP: [], FORMATION: [], APPOINTMENT: [], ADJUSTMENT: [], TRANSFER: [], STAFF_RENT: [] };
    for (const row of idRows) idsBySource[row.sourceType]?.push(row.id);

    const [orders, workshops, formations, appointments, adjustments, transfers, staffRent] = await Promise.all([
      hydrateOrders(idsBySource.ORDER),
      hydrateWorkshops(idsBySource.WORKSHOP),
      hydrateFormations(idsBySource.FORMATION),
      hydrateAppointmentTransactions(idsBySource.APPOINTMENT),
      hydrateAdjustments(idsBySource.ADJUSTMENT),
      hydrateTransfers(idsBySource.TRANSFER),
      hydrateStaffRentTransactions(idsBySource.STAFF_RENT),
    ]);

    const byId = new Map();
    for (const row of [...orders, ...workshops, ...formations, ...appointments, ...adjustments, ...transfers, ...staffRent]) {
      byId.set(row.id, row);
    }
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
      staffId: scope.staffId,
      staffName: scope.staffName,
      readOnly: !isAdmin,
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
      staffId: scope.staffId,
      staffName: scope.staffName,
      readOnly: !isAdmin,
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
  const session = await requireAdminOperationsAccess();
  if (!session) {
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
              select: { id: true, status: true, customerNotifiedAt: true, creditNote: { select: { id: true, number: true, emailSentAt: true, peppyrusSentAt: true } } },
            },
          },
        },
        payment: {
          // `include` (not `select`) here, so every scalar Payment column —
          // ticketEmailedAt included — comes back automatically alongside
          // these nested relations; only ticketEmailedAt is set exclusively
          // by the manual, permission-gated send in
          // actions/payments/send-ticket-email.js, never by settlement
          // itself, so the drawer uses it to answer "was this client's
          // ticket actually e-mailed."
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
                customerEmail: true,
                // Feeds summarizeRefundState's fullyCredited below AND the
                // drawer's own "Note de crédit" section. Both are needed:
                // the note that cancels a sale hangs off the REFUND row, so
                // opening the cancelled sale's own transaction would
                // otherwise show no note at all — nothing to download, and
                // no way to send it to the client.
                creditNotes: {
                  select: {
                    id: true,
                    number: true,
                    issuedAt: true,
                    reason: true,
                    totalInclVat: true,
                    emailSentAt: true,
                    peppyrusSentAt: true,
                  },
                  orderBy: { issuedAt: "asc" },
                },
              },
            },
            // "Is a cancellation already open on this payment?" — the same
            // question openRefundOperation asks before resuming instead of
            // creating a second operation. The drawer needs it to stop
            // offering its two cancel buttons once a credit note has already
            // been issued: a second click can only ever resume the existing
            // operation (no second note), which reads as the button doing
            // nothing. Deliberately only the in-flight statuses, so a
            // settled partial return still leaves the rest refundable.
            refundOperations: {
              where: { status: { in: ["PENDING", "PARTIALLY_REFUNDED"] } },
              select: { id: true, status: true },
            },
            // Sibling transactions: a 50 % acompte followed by a balance
            // settled at the counter are two rows against one Payment, and
            // reading either one alone misrepresents what the customer paid.
            transactions: { orderBy: { paidAt: "asc" }, select: { id: true, amount: true, method: true, transactionType: true, paidAt: true, isDeleted: true } },
            order: { select: { id: true, orderNumber: true, status: true, fulfilmentMode: true, pickupCode: true, pickedUpAt: true, user: { select: { fullName: true, email: true } }, createdByStaff: { select: { fullName: true, role: true } } } },
            workshopReservation: { select: { id: true, status: true, seatsCount: true, checkInCode: true, checkedInAt: true, checkedInSeats: true, session: { select: { startDate: true, workshop: { select: { title: true, type: true } }, animator: { select: { name: true, email: true } } } }, customer: { select: { fullName: true, email: true } } } },
            formationReservation: { select: { id: true, status: true, seatsCount: true, checkInCode: true, checkedInAt: true, checkedInSeats: true, session: { select: { startDate: true, formation: { select: { title: true, type: true } }, animator: { select: { name: true, email: true } } } }, customer: { select: { fullName: true, email: true } } } },
            appointment: { select: { id: true, date: true, status: true, checkInCode: true, checkedInAt: true, user: { select: { fullName: true, email: true } }, staffService: { select: { staff: { select: { user: { select: { fullName: true, role: true } } } } } } } },
          },
        },
      },
    });

    if (!transaction) return { success: false, message: "Transaction introuvable." };
    // The salon's drawer never opens an independent's sale — her customer,
    // her amounts, her refunds. Opérations does not list them; this closes the
    // same door for a transaction id reached any other way.
    if (transaction.payment?.payeeStaffId) return { success: false, message: "Non autorisé." };

    // Drives the drawer's "Annuler et rembourser" gate — same formula
    // InvoiceRowActions uses for the Transactions-tab row, computed here via
    // the canonical helper instead of re-deriving it ad hoc client-side.
    const refundState = summarizeRefundState({
      transactions: transaction.payment?.transactions ?? [],
      invoice: transaction.payment?.invoice ?? null,
    });

    // Same "who on staff/admin side this revenue belongs to" attribution as
    // getAdminOperations' three hydrators — see resolveStaffByEmails' doc
    // comment for the formation animator bridge. Attached onto the specific
    // relation describeSource() already branches on
    // (components/dashboard/operations/TransactionDetailDrawer.jsx), rather
    // than a new top-level field.
    if (transaction.payment?.order) {
      const staff = transaction.payment.order.createdByStaff;
      transaction.payment.order.performedBy = staff ? { name: staff.fullName, role: staff.role } : null;
    } else if (transaction.payment?.appointment) {
      const staffUser = transaction.payment.appointment.staffService?.staff?.user;
      transaction.payment.appointment.performedBy = staffUser ? { name: staffUser.fullName, role: staffUser.role } : null;
    } else if (transaction.payment?.workshopReservation) {
      const animator = transaction.payment.workshopReservation.session?.animator;
      let performedBy = null;
      if (animator) {
        const staffByEmail = await resolveStaffByEmails([animator.email]);
        performedBy = staffByEmail.get(animator.email) ?? { name: animator.name, role: null };
      }
      transaction.payment.workshopReservation.performedBy = performedBy;
    } else if (transaction.payment?.formationReservation) {
      const animator = transaction.payment.formationReservation.session?.animator;
      let performedBy = null;
      if (animator) {
        const staffByEmail = await resolveStaffByEmails([animator.email]);
        performedBy = staffByEmail.get(animator.email) ?? { name: animator.name, role: null };
      }
      transaction.payment.formationReservation.performedBy = performedBy;
    }

    // The drawer is the only surface that can e-mail a ticket for a booking
    // whose balance was discounted to zero: no Transaction is created for that
    // settlement, so it never reaches the Livre de caisse, which is where the
    // only other send button lives. Resolved through canSendTicketEmail()
    // rather than assumed from this action's admin-only gate, so narrowing
    // that gate later cannot silently hand the button to someone who
    // shouldn't have it.
    const canSendTicketEmail = await canSendTicketEmailOperator(session.user);

    // ticketEmailedAt records only *that* a ticket went out, never for which
    // price. A counter adjustment after a send leaves the client holding a
    // receipt for a total that no longer exists, so the drawer compares the two
    // timestamps and says so — see the "reçu obsolète" line in
    // TransactionDetailDrawer.
    const lastPriceAdjustedAt = transaction.payment?.ticketEmailedAt
      ? await resolveLastPriceAdjustment(transaction.payment)
      : null;

    // The same check-in QR the customer got attached to their confirmation
    // e-mail (lib/activities/appointment-check-in-qr.js and the reservation
    // equivalents) — regenerated here from the stored plaintext code rather
    // than kept anywhere as an image, same as the customer's own /mon-compte
    // and /mes-reservations views. Staff needs this to show a client who lost
    // the e-mail their code again, or to confirm one was actually minted.
    const checkIn = await resolveCheckInAsset(transaction.payment);

    return {
      success: true,
      data: serializeDecimalFields({
        ...transaction,
        canSendTicketEmail,
        lastPriceAdjustedAt,
        checkIn,
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
 * The detail drawer for a boutique order that has no Transaction yet — a
 * "réserver en ligne, payer au retrait" pickup still waiting for the
 * customer, most of the time. getTransactionDetail is keyed on a Transaction
 * and such an order has none (PICKUP_ON_SITE creates its Payment only at the
 * counter, see completeOrderPickup), so the row used to offer no way in at
 * all — not even to show a client who lost the e-mail their pickup QR code.
 *
 * Read-only on purpose: nothing has been collected, so there is no ticket,
 * no invoice and nothing to refund. The drawer shows the order, its items
 * and its QR code, and says the receipt comes with the payment.
 */
export async function getPendingOrderDetail(orderId) {
  const session = await requireAdminOperationsAccess();
  if (!session) {
    return { success: false, message: "Non autorisé." };
  }
  if (typeof orderId !== "string" || !orderId) {
    return { success: false, message: "Commande introuvable." };
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        source: true,
        fulfilmentMode: true,
        createdAt: true,
        expiresAt: true,
        readyForPickupAt: true,
        cancelledAt: true,
        cancelReason: true,
        subtotal: true,
        discountAmount: true,
        totalAmount: true,
        totalExclVat: true,
        totalVat: true,
        vatRate: true,
        notes: true,
        pickupCode: true,
        pickedUpAt: true,
        stockReleasedAt: true,
        settledBySale: { select: { id: true, orderNumber: true } },
        user: { select: { fullName: true, email: true } },
        createdByStaff: { select: { fullName: true, role: true } },
        items: { select: { id: true, productName: true, variantName: true, quantity: true, unitPrice: true }, orderBy: { createdAt: "asc" } },
        payment: { select: { status: true, transactions: { where: { isDeleted: false }, select: { id: true } } } },
      },
    });
    if (!order) return { success: false, message: "Commande introuvable." };

    // Once money has moved this is an ordinary transaction and belongs in
    // getTransactionDetail — with its ticket, invoice and refund actions.
    // A settled Payment with no live Transaction is not "unpaid" either, and
    // must not be shown as such.
    const settled = order.payment && !["PENDING", "FAILED", "PARTIALLY_PAID"].includes(order.payment.status);
    if ((order.payment?.transactions ?? []).length > 0 || settled) {
      return { success: false, message: "Cette commande a déjà été encaissée — ouvrez sa transaction." };
    }

    const { payment, createdByStaff, ...rest } = order;
    const detailOrder = {
      ...rest,
      performedBy: createdByStaff ? { name: createdByStaff.fullName, role: createdByStaff.role } : null,
    };
    // Only while the order can still be collected. An abandoned Stripe
    // checkout, a cancelled order or one whose stock is already back on sale
    // has a code nobody should be handed: scanning it would only be refused.
    const collectable =
      ["PENDING_PICKUP", "READY_FOR_PICKUP"].includes(order.status) ||
      (order.status === "EXPIRED" && !order.stockReleasedAt);
    const checkIn = collectable ? await resolveCheckInAsset({ order: detailOrder }) : null;

    return {
      success: true,
      data: serializeDecimalFields({ pendingOrder: true, order: detailOrder, checkIn }),
    };
  } catch (error) {
    console.error("[getPendingOrderDetail]", error);
    return { success: false, message: "Impossible de charger le détail de cette commande." };
  }
}

/**
 * When this payment's booking was last repriced at the counter, or null if it
 * never was. The audit row is the only record of an adjustment — nothing on
 * Payment itself distinguishes a total that was always 40 € from one discounted
 * down to it — and it is polymorphic over the three booking types, keyed the
 * same way the three settlement paths write it (AUDIT_ACTIONS
 * .RESERVATION_PRICE_ADJUSTED on the reservation, not on the Payment).
 */
/**
 * The polymorphic Payment carries at most one check-in code, on whichever
 * relation is actually populated — same branching as describeSource() in
 * TransactionDetailDrawer.jsx. Only a CONFIRMED reservation/appointment ever
 * has one (see the checkInCode column comments in prisma/schema.prisma), and
 * a boutique order only for pickup fulfilment, so null here just means
 * "nothing to show," not a data problem.
 */
async function resolveCheckInAsset(payment) {
  if (payment?.appointment?.checkInCode) {
    const { checkInCode: code, checkedInAt } = payment.appointment;
    return { kind: "APPOINTMENT", code, usedAt: checkedInAt, seatsLabel: null, qr: await checkInQrDataUrl(code) };
  }
  if (payment?.workshopReservation?.checkInCode) {
    const r = payment.workshopReservation;
    return {
      kind: "WORKSHOP",
      code: r.checkInCode,
      usedAt: r.checkedInAt,
      seatsLabel: `${r.checkedInSeats}/${r.seatsCount} place(s) scannée(s)`,
      qr: await checkInQrDataUrl(r.checkInCode),
    };
  }
  if (payment?.formationReservation?.checkInCode) {
    const r = payment.formationReservation;
    return {
      kind: "FORMATION",
      code: r.checkInCode,
      usedAt: r.checkedInAt,
      seatsLabel: `${r.checkedInSeats}/${r.seatsCount} place(s) scannée(s)`,
      qr: await checkInQrDataUrl(r.checkInCode),
    };
  }
  if (payment?.order?.pickupCode) {
    const { pickupCode: code, pickedUpAt } = payment.order;
    return { kind: "ORDER_PICKUP", code, usedAt: pickedUpAt, seatsLabel: null, qr: await pickupQrDataUrl(code) };
  }
  return null;
}

async function resolveLastPriceAdjustment(payment) {
  const booking = payment.appointment
    ? { entityType: "Appointment", entityId: payment.appointment.id }
    : payment.workshopReservation
      ? { entityType: "WorkshopReservation", entityId: payment.workshopReservation.id }
      : payment.formationReservation
        ? { entityType: "FormationReservation", entityId: payment.formationReservation.id }
        : null;
  if (!booking) return null;

  const row = await prisma.auditLog.findFirst({
    where: { action: AUDIT_ACTIONS.RESERVATION_PRICE_ADJUSTED, ...booking },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

/**
 * One transfer's full detail, by its AuditLog id — for the "↔ Transférée
 * le ..." cross-link on a Workshop/Formation row. That row's own page may
 * not include the transfer as one of its 30 hydrated rows (different tab,
 * different filter, different page of pagination), so this is a dedicated
 * round trip rather than a lookup into whatever the current page already
 * fetched. Reuses hydrateTransfers exactly as the main list does, so the
 * TransferDetailModal renders an identical shape either way it was opened.
 */
export async function getTransferDetail(auditLogId) {
  if (!(await requireAdminOperationsAccess())) {
    return { success: false, message: "Non autorisé." };
  }
  if (typeof auditLogId !== "string" || !auditLogId) {
    return { success: false, message: "Transfert introuvable." };
  }

  try {
    const [transfer] = await hydrateTransfers([auditLogId]);
    if (!transfer) return { success: false, message: "Transfert introuvable." };
    return { success: true, data: serializeDecimalFields(transfer) };
  } catch (error) {
    console.error("[getTransferDetail]", error);
    return { success: false, message: "Impossible de charger le détail de ce transfert." };
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
