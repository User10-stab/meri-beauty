"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { qrPngAttachment } from "@/lib/qrcode";
import { CHECK_IN_KINDS, ensureCheckInCode } from "@/lib/activities/check-in-code";
import { STAFF_PERMISSIONS, hasDashboardPermission } from "@/lib/authorization";
import { counterCustomerSchema } from "@/lib/validations/counter-customer";
import { resolveCounterCustomer } from "@/lib/counter/resolve-counter-customer";
import { CounterCustomerError, PhoneAlreadyRegisteredError } from "@/lib/reservation-errors";
import { resolveServiceVatPolicy, repriceTtcCataloguePrice, hasInvoiceableVatIdentity, isPeppolMandatoryCustomer } from "@/lib/tax-policy";
import { resolveCounterPriceAdjustment } from "@/lib/payments/counter-price-adjustment";
import { issueInvoice, buildInvoiceCustomer, buildServiceInvoiceLines } from "@/lib/invoicing";
import { OCCUPANCY_KINDS, sessionOccupancy } from "@/lib/reservations/session-occupancy";
import { allocatePieceNumber, PIECE_SERIES, seriesForActivityType } from "@/lib/cash-book/piece-number";
import { revalidateCaisseRoutes } from "@/lib/cash-book/revalidate-caisse";
import { workshopReservationConfirmationEmail, formationReservationConfirmationEmail } from "@/lib/email-templates";
import { sendLowSeatsBroadcast } from "@/lib/workshops/notify-low-seats";
import { sendFormationLowSeatsBroadcast } from "@/lib/formations/notify-low-seats";
import { revalidatePath } from "next/cache";

/**
 * Sells a brand-new workshop/formation/événement seat at the counter —
 * staff creating a reservation on the spot instead of a customer booking it
 * online.
 *
 * Deliberately its own transaction rather than "create, then settleReservation":
 * settleReservation refuses a session that hasn't happened yet
 * (lib/reservations/settle-reservation.js), which is exactly the case here.
 * It also deliberately does NOT copy createCounterWalkInService's
 * compensating `prisma.<x>.delete` on a downstream failure — by the time
 * that would run here, a piece number may already be allocated and an
 * invoice number already burned, neither of which a delete can unwind.
 * Everything below commits atomically or not at all, in one transaction.
 */

const COUNTER_CREATE_KINDS = {
  WORKSHOP: {
    sessionDelegate: (client) => client.workshopSession,
    reservationDelegate: (client) => client.workshopReservation,
    sessionTable: "workshop_sessions",
    catalogueKey: "workshop",
    catalogueSelect: { select: { id: true, title: true, type: true, price: true, depositPercentage: true, status: true, capacity: true } },
    occupancyKind: OCCUPANCY_KINDS.WORKSHOP,
    checkInKind: CHECK_IN_KINDS.WORKSHOP,
    invoiceSource: "WORKSHOP",
    reservationPermission: STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS,
    entityType: "WorkshopReservation",
    ticketFilePrefix: "billet-atelier",
    seriesOf: (catalogue) => seriesForActivityType(catalogue.type),
    buildConfirmationEmail: (args) => workshopReservationConfirmationEmail({ activityTitle: args.title, ...args }),
    lowSeatsBroadcast: sendLowSeatsBroadcast,
    revalidatePath: "/dashboard/workshops/reservations",
  },
  FORMATION: {
    sessionDelegate: (client) => client.formationSession,
    reservationDelegate: (client) => client.formationReservation,
    sessionTable: "formation_sessions",
    catalogueKey: "formation",
    catalogueSelect: { select: { id: true, title: true, price: true, depositPercentage: true, status: true, capacity: true } },
    occupancyKind: OCCUPANCY_KINDS.FORMATION,
    checkInKind: CHECK_IN_KINDS.FORMATION,
    invoiceSource: "FORMATION",
    reservationPermission: STAFF_PERMISSIONS.FORMATION_RESERVATIONS,
    entityType: "FormationReservation",
    ticketFilePrefix: "billet-formation",
    seriesOf: () => PIECE_SERIES.FORMATION,
    buildConfirmationEmail: (args) => formationReservationConfirmationEmail({ formationTitle: args.title, ...args }),
    lowSeatsBroadcast: sendFormationLowSeatsBroadcast,
    revalidatePath: "/dashboard/formations/reservations",
  },
};

// Same "existing account, or a brand-new one with a phone" shape as
// walk-in-service.js's own customerSchema — a phone is required only for a
// customer created here from nothing, since a returning one already has one
// on file or one isn't needed to reach them.
const buyerSchema = z.union([
  z.object({ userId: z.string().min(1) }).merge(
    counterCustomerSchema.pick({
      vatNumber: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressPostalCode: true,
      addressCountry: true,
    })
  ),
  counterCustomerSchema.omit({ id: true }).extend({ phone: z.string().trim().min(6) }),
]);

const createReservationSchema = z.object({
  kind: z.enum(["WORKSHOP", "FORMATION"]),
  sessionId: z.string().min(1),
  seatsCount: z.number().int().min(1).max(50),
  customer: buyerSchema,
  finalTotal: z.number().nonnegative().max(100_000).optional(),
  adjustmentReason: z.string().trim().max(250).optional(),
  payment: z.object({
    mode: z.enum(["FULL", "DEPOSIT"]),
    method: z.enum(["CASH", "EXTERNAL_TERMINAL"]),
    paymentConfirmed: z.literal(true),
    terminalReference: z.string().trim().max(100).optional(),
  }),
});

function money(value) {
  return Number(Number(value ?? 0).toFixed(2));
}

const ERROR_MESSAGES = {
  SESSION_NOT_FOUND: "Séance introuvable.",
  SESSION_NOT_AVAILABLE: "Cette séance n'est plus planifiée ou n'est plus publiée.",
  SESSION_ENDED: "Cette séance est déjà terminée.",
  INVALID_SESSION_CAPACITY: "Capacité de séance invalide.",
  SESSION_FULL: "Pas assez de places disponibles sur cette séance.",
  CASH_SESSION_REQUIRED: "Aucune session de caisse n'est ouverte. Ouvrez la caisse avant d'encaisser en espèces.",
  SELLER_LEGAL_DATA_INCOMPLETE:
    "Identité légale du salon incomplète — complétez Réglages > Salon avant de vendre une réservation facturée.",
};

function errorMessage(code) {
  return ERROR_MESSAGES[code] ?? "Impossible d'enregistrer cette réservation.";
}

async function authorizeCounterBooking(kind) {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  const config = COUNTER_CREATE_KINDS[kind];
  const [canUseTill, canReserve] = await Promise.all([
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.POINT_OF_SALE),
    hasDashboardPermission(session.user, config.reservationPermission),
  ]);
  if (!canUseTill || !canReserve) return { error: "Accès non autorisé." };
  return { session };
}

function formatSessionDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

/**
 * @param {object} input
 * @param {"WORKSHOP"|"FORMATION"} input.kind
 * @param {string} input.sessionId
 * @param {number} input.seatsCount
 * @param {object} input.customer `{ userId }` or a new-customer shape.
 * @param {number} [input.finalTotal] Operator override of the catalogue total.
 * @param {string} [input.adjustmentReason] Required whenever finalTotal changes it.
 * @param {object} input.payment `{ mode: "FULL"|"DEPOSIT", method, paymentConfirmed, terminalReference? }`
 */
export async function createCounterReservation(input) {
  const parsed = createReservationSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Vérifiez la séance, le client et le paiement." };
  const data = parsed.data;
  const config = COUNTER_CREATE_KINDS[data.kind];

  const guard = await authorizeCounterBooking(data.kind);
  if (guard.error) return { success: false, message: guard.error };

  if (data.payment.method === "EXTERNAL_TERMINAL" && !data.payment.terminalReference?.trim()) {
    return { success: false, message: "Indiquez la référence du ticket du terminal." };
  }

  let result;
  try {
    result = await prisma.$transaction(
      async (tx) => {
        // Cash hard-blocks without an open till; card never does — a
        // brand-new cash sale is money with no other record anywhere if the
        // till line goes missing, unlike settling an existing balance
        // (settleReservation only warns for that). Checked inside the
        // transaction so the answer is authoritative, not a query made
        // moments before the actual write.
        let openCashSession = null;
        if (data.payment.method === "CASH") {
          openCashSession = await tx.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } });
          if (!openCashSession) throw new Error("CASH_SESSION_REQUIRED");
        }

        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM ${Prisma.raw(config.sessionTable)} WHERE id = ${data.sessionId} FOR UPDATE`
        );

        const session = await config.sessionDelegate(tx).findUnique({
          where: { id: data.sessionId },
          include: { [config.catalogueKey]: config.catalogueSelect },
        });
        if (!session) throw new Error("SESSION_NOT_FOUND");
        const catalogue = session[config.catalogueKey];
        if (session.status !== "SCHEDULED" || catalogue.status !== "PUBLISHED") {
          throw new Error("SESSION_NOT_AVAILABLE");
        }
        // Deliberately laxer than changeReservationSession's `startDate > now`
        // — a seat may still be sold for a session that has started but not
        // ended (assumption #4 of the unified-counter plan).
        if (session.endDate && new Date(session.endDate) <= new Date()) {
          throw new Error("SESSION_ENDED");
        }

        const takenSeats = await sessionOccupancy(tx, { kind: config.occupancyKind, sessionId: session.id });
        const capacity = session.capacity ?? catalogue.capacity;
        if (!Number.isInteger(capacity) || capacity < 1) throw new Error("INVALID_SESSION_CAPACITY");
        if (takenSeats + data.seatsCount > capacity) throw new Error("SESSION_FULL");

        // resolveCounterCustomer enforces the B2B address rule up front —
        // required even for a deposit sale, because settleReservation issues
        // the real invoice months later with no way to ask for one then.
        const user = await resolveCounterCustomer(tx, data.customer);

        const vatPolicy = resolveServiceVatPolicy({ customer: user });
        const unitPrice = repriceTtcCataloguePrice(Number(catalogue.price), vatPolicy.vatRate);
        const catalogueTotal = money(unitPrice * data.seatsCount);

        const priceAdjustment = resolveCounterPriceAdjustment({
          baseTotal: catalogueTotal,
          paidAmount: 0,
          finalTotal: data.finalTotal,
          reason: data.adjustmentReason,
        });
        if (!priceAdjustment.success) {
          throw Object.assign(new Error("PRICE_ADJUSTMENT_INVALID"), { userMessage: priceAdjustment.message });
        }
        const total = priceAdjustment.finalTotal;

        const isFullPayment = data.payment.mode === "FULL";
        const rawDepositPct = Number(catalogue.depositPercentage ?? 50);
        const depositPct = Number.isFinite(rawDepositPct) ? Math.min(100, Math.max(0, rawDepositPct)) : 0;
        const depositAmount = isFullPayment ? total : money((total * depositPct) / 100);
        const collected = isFullPayment ? total : depositAmount;
        const balanceDue = money(total - collected);

        const reservation = await config.reservationDelegate(tx).create({
          data: {
            sessionId: session.id,
            customerId: user.id,
            seatsCount: data.seatsCount,
            totalPrice: total,
            depositAmount,
            balanceDue,
            discountAmount: 0,
            status: "CONFIRMED",
          },
        });

        const payment = await tx.payment.create({
          data: {
            [data.kind === "WORKSHOP" ? "workshopReservationId" : "formationReservationId"]: reservation.id,
            depositAmount: isFullPayment ? 0 : collected,
            totalAmount: total,
            paidAmount: collected,
            remainingAmount: balanceDue,
            paymentType: isFullPayment ? "ON_SITE" : "DEPOSIT",
            status: balanceDue <= 0.01 ? "PAID" : "PARTIALLY_PAID",
            paidAt: new Date(),
          },
        });

        const series = config.seriesOf(catalogue);
        const pieceNumber = data.payment.method === "CASH" ? await allocatePieceNumber(tx, series) : null;

        await tx.transaction.create({
          data: {
            paymentId: payment.id,
            amount: collected,
            method: data.payment.method === "CASH" ? "CASH" : "CARD",
            transactionType: isFullPayment ? "FINAL_PAYMENT" : "DEPOSIT",
            paidAt: new Date(),
            cashSessionId: openCashSession?.id ?? null,
            pieceNumber,
            manualReference: data.payment.method === "EXTERNAL_TERMINAL" ? data.payment.terminalReference.trim() : null,
          },
        });

        // A deposit is never invoiced — the legally-required invoice is
        // issued once the full amount is settled, exactly like every other
        // reservation (see settleReservation). Full payment invoices
        // immediately, same rule as the online full-payment path.
        const invoice =
          isFullPayment && hasInvoiceableVatIdentity(user)
            ? await issueInvoice(tx, {
                paymentId: payment.id,
                source: config.invoiceSource,
                totalInclVat: total,
                customer: buildInvoiceCustomer(user),
                lines: buildServiceInvoiceLines({
                  description: `${catalogue.title} (${data.seatsCount} place${data.seatsCount > 1 ? "s" : ""})`,
                  totalAmount: total,
                }),
              })
            : null;

        await tx.auditLog.create({
          data: {
            actorId: guard.session.user.id,
            actorRole: guard.session.user.role,
            action: "reservation.created_at_counter",
            entityType: config.entityType,
            entityId: reservation.id,
            after: {
              status: "CONFIRMED",
              sessionId: session.id,
              seatsCount: data.seatsCount,
              cataloguePrice: catalogueTotal,
              finalTotal: total,
              paymentMode: data.payment.mode,
              paymentMethod: data.payment.method,
            },
          },
        });

        return {
          reservationId: reservation.id,
          title: catalogue.title,
          sessionStartDate: session.startDate,
          customer: { fullName: user.fullName, email: user.email, isCompany: user.isCompany, vatNumber: user.vatNumber, vatValidatedAt: user.vatValidatedAt },
          seatsCount: data.seatsCount,
          paidAmount: collected,
          totalAmount: total,
          balanceDue,
          isFullPayment,
          invoice: invoice ? { number: invoice.number } : null,
          method: data.payment.method,
        };
      },
      { timeout: 15_000 }
    );
  } catch (error) {
    if (error instanceof CounterCustomerError) {
      return { success: false, message: error.message };
    }
    if (error instanceof PhoneAlreadyRegisteredError) {
      return { success: false, message: "Ce numéro est déjà associé à un autre compte." };
    }
    if (error.message === "PRICE_ADJUSTMENT_INVALID") {
      return { success: false, message: error.userMessage };
    }
    if (error.message === "CASH_SESSION_REQUIRED") {
      return { success: false, message: errorMessage(error.message), requiresCashSession: true };
    }
    const knownMessage = errorMessage(error?.message);
    if (knownMessage !== "Impossible d'enregistrer cette réservation.") {
      return { success: false, message: knownMessage };
    }
    console.error("[createCounterReservation]", error);
    return { success: false, message: knownMessage };
  }

  // Minted AFTER the transaction has committed, same reasoning as
  // confirmWorkshopReservationPayment / confirmFormationReservationPayment:
  // a check-in-code collision must never sit on the rollback path of money
  // already physically collected at the till.
  const checkInCode = await ensureCheckInCode(prisma, config.checkInKind, result.reservationId).catch((error) => {
    console.error("[createCounterReservation] check-in code generation failed:", error);
    return null;
  });
  const ticketQr = checkInCode
    ? await qrPngAttachment(checkInCode, `${config.ticketFilePrefix}-${checkInCode}.png`).catch((error) => {
        console.error("[createCounterReservation] ticket QR generation failed:", error);
        return null;
      })
    : null;

  const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { phone: true, email: true } });
  const pendingInvoiceNote = !result.invoice
    ? ""
    : isPeppolMandatoryCustomer(result.customer)
      ? `Votre facture officielle (n°${result.invoice.number}) vous sera transmise séparément via le réseau Peppol, conformément à la réglementation belge.`
      : `Votre facture officielle (n°${result.invoice.number}) vous sera transmise séparément par e-mail.`;

  const emailResult = await sendEmail({
    to: result.customer.email,
    ...config.buildConfirmationEmail({
      customerName: result.customer.fullName,
      title: result.title,
      sessionDate: formatSessionDate(result.sessionStartDate),
      seatsCount: result.seatsCount,
      paidAmount: result.paidAmount,
      totalAmount: result.totalAmount,
      balanceDue: result.balanceDue,
      isFullPayment: result.isFullPayment,
      salonPhone: salon?.phone,
      salonEmail: salon?.email,
      pendingInvoiceNote,
      checkInCode,
    }),
    ...(ticketQr ? { attachments: [ticketQr] } : {}),
  }).catch((error) => {
    console.error("[createCounterReservation] confirmation email failed:", error);
    return { success: false };
  });

  config.lowSeatsBroadcast(data.sessionId).catch((error) =>
    console.error("[createCounterReservation] low-seats broadcast failed:", error)
  );

  if (data.payment.method === "CASH") revalidateCaisseRoutes();
  revalidatePath(config.revalidatePath);
  revalidatePath("/dashboard/operations");

  return {
    success: true,
    message: emailResult?.success
      ? "Réservation enregistrée et e-mail de confirmation envoyé."
      : "Réservation enregistrée, mais l'e-mail n'a pas pu être envoyé.",
    emailSent: Boolean(emailResult?.success),
    data: {
      reservationId: result.reservationId,
      checkInCode,
      seatsCount: result.seatsCount,
      totalAmount: result.totalAmount,
      paidAmount: result.paidAmount,
      balanceDue: result.balanceDue,
      invoiceNumber: result.invoice?.number ?? null,
    },
  };
}
