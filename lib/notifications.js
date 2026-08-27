/**
 * Notification Service — single entry point for all notification creation and
 * lifecycle operations. All business modules MUST use this service instead of
 * touching Prisma directly.
 *
 * Transaction safety (core design rule):
 *   A notification and the business event that triggered it MUST commit or
 *   roll back together. To enforce this, the service optionally accepts a
 *   Prisma transaction client as the FIRST positional argument of `options`.
 *   When provided, every write is performed against that transaction client;
 *   the outer caller is responsible for committing/rolling back the
 *   transaction, so an order rollback also cancels its "payment received"
 *   notification, avoiding "phantom" notifications for events that never
 *   happened.
 *
 *   When no transaction client is supplied, the global `prisma` singleton is
 *   used for standalone, non-transactional writes.
 *
 * Extensibility for future notification templates:
 *   Every `create*` call accepts an optional `payload` field (record of
 *   arbitrary primitives). Today the payload is validated and dropped;
 *   tomorrow it can drive template rendering, variable substitution, email
 *   generation, or deep-link enrichment, without changing any existing
 *   caller. A `renderTemplate(templateKey, payload)` helper can be added
 *   here later in a fully backward-compatible way.
 *
 * Authentication / ownership:
 *   This is a SERVER-SIDE ONLY library. Callers are trusted code running
 *   inside webhook handlers, server actions, or cron routes — code that
 *   already proved the `userId` it's writing for. The server actions layer
 *   (actions/notifications/notifications.js) is responsible for re-checking
 *   auth AND ownership whenever an end-user-triggered action (mark read,
 *   delete) passes through it.
 */

import { prisma } from "@/lib/prisma";
import { triggerNotificationEvent } from "@/lib/realtime/pusher-server";
import { normalizeStaffPermissions } from "@/lib/authorization";
import {
  createNotificationSchema,
  createNotificationsBulkSchema,
  listUserNotificationsSchema,
  notificationIdSchema,
} from "@/lib/validations/notification";

const NOTIFICATION_SELECT_FIELDS = {
  id: true,
  userId: true,
  type: true,
  title: true,
  message: true,
  actionUrl: true,
  appointmentId: true,
  status: true,
  isRead: true,
  sentAt: true,
  createdAt: true,
};

/**
 * Resolve the Prisma client to use: the caller-provided transaction client
 * inside `options.tx` if present, otherwise the global singleton.
 *
 * This keeps every function signature small — `createNotification(input, { tx })`
 * instead of `(txOrPrisma, input)` — while still giving callers a single,
 * consistent optional argument for transaction binding.
 *
 * @template {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} T
 * @param {{ tx?: T }} [options]
 * @returns {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient}
 */
function resolveClient(options) {
  return options?.tx ?? prisma;
}

/**
 * Serialize a raw Prisma Notification row for cross-boundary transfer
 * (server actions → client, or return values passing through function layers).
 * All Date fields → ISO strings so the object is JSON-safe (Decimal fields
 * do not exist on the Notification model today — still kept for symmetry
 * with the other serialize helpers in lib/serialize-prisma.js).
 *
 * @param {object | null | undefined} raw
 * @returns {object | null}
 */
export function serializeNotification(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    type: raw.type,
    title: raw.title,
    message: raw.message,
    actionUrl: raw.actionUrl ?? null,
    appointmentId: raw.appointmentId ?? null,
    status: raw.status,
    isRead: Boolean(raw.isRead),
    sentAt: raw.sentAt ? raw.sentAt.toISOString() : null,
    createdAt: raw.createdAt ? raw.createdAt.toISOString() : null,
  };
}

/* ─── helpers for pagination cursor ─────────────────────────────────── */

function encodeCursor(createdAt, id) {
  const payload = JSON.stringify({
    createdAt: typeof createdAt === "string" ? createdAt : createdAt.toISOString(),
    id,
  });
  return Buffer.from(payload, "utf-8").toString("base64url");
}

function decodeCursor(cursorString) {
  try {
    const raw = Buffer.from(cursorString, "base64url").toString("utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      return null;
    }
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    return null;
  }
}

/* ─── Appointment-specific builders (extensibility / template hook) ─── */
/**
 * Build the `input` object for createNotification() from a raw appointment
 * record. The returned object includes an extensible `payload` record with
 * typed fields. Future phases can use the payload to render rich templates
 * or drive email generation without changing the callers.
 *
 * The builders below are intentionally thin (pure-ish data transformers) so
 * callers that need a custom message (e.g. reschedule, cancellations with a
 * reason) can override individual fields with the spread operator.
 */

function formatFrDate(date) {
  const d = typeof date === "string" || date instanceof Date ? new Date(date) : date;
  if (!d || Number.isNaN(d.getTime())) return "la date prévue";
  return d.toLocaleDateString("fr-FR");
}

function formatFrTime(date) {
  const d = typeof date === "string" || date instanceof Date ? new Date(date) : date;
  if (!d || Number.isNaN(d.getTime())) return "l'heure prévue";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * @param {{ userId: string, appointmentId: string, date: Date|string, startTime?: Date|string, serviceName?: string, staffName?: string, customerName?: string }} data
 * @returns {{ userId: string, type: 'APPOINTMENT_CREATED', title: string, message: string, appointmentId: string, actionUrl: string, payload: Record<string, unknown> }}
 */
export function buildAppointmentCreatedNotification(data) {
  const dateStr = formatFrDate(data.date);
  const timeStr = data.startTime ? ` à ${formatFrTime(data.startTime)}` : "";
  const service = data.serviceName ? ` (${data.serviceName})` : "";
  const customer = data.customerName ? ` — ${data.customerName}` : "";
  const withStaff = data.staffName ? ` avec ${data.staffName}` : "";
  return {
    userId: data.userId,
    type: "APPOINTMENT_CREATED",
    title: "Nouveau rendez-vous",
    message: `Nouveau rendez-vous${service}${withStaff} le ${dateStr}${timeStr}${customer}.`,
    appointmentId: data.appointmentId,
    actionUrl: "/dashboard/appointments",
    payload: {
      appointmentId: data.appointmentId,
      date: data.date instanceof Date ? data.date.toISOString() : String(data.date),
      startTime: data.startTime
        ? data.startTime instanceof Date
          ? data.startTime.toISOString()
          : String(data.startTime)
        : null,
      serviceName: data.serviceName ?? null,
      staffName: data.staffName ?? null,
      customerName: data.customerName ?? null,
    },
  };
}

/**
 * @param {{ userId: string, appointmentId: string, date: Date|string, startTime?: Date|string, serviceName?: string, staffName?: string, customerName?: string }} data
 * @returns {{ userId: string, type: 'APPOINTMENT_CONFIRMED', title: string, message: string, appointmentId: string, actionUrl: string, payload: Record<string, unknown> }}
 */
export function buildAppointmentConfirmedNotification(data) {
  const dateStr = formatFrDate(data.date);
  const timeStr = data.startTime ? ` à ${formatFrTime(data.startTime)}` : "";
  const service = data.serviceName ? ` (${data.serviceName})` : "";
  const customer = data.customerName ? ` — ${data.customerName}` : "";
  const withStaff = data.staffName ? ` avec ${data.staffName}` : "";
  return {
    userId: data.userId,
    type: "APPOINTMENT_CONFIRMED",
    title: "Nouveau rendez-vous",
    message: `Nouveau rendez-vous${service}${withStaff} le ${dateStr}${timeStr}${customer}.`,
    appointmentId: data.appointmentId,
    actionUrl: "/dashboard/appointments",
    payload: {
      appointmentId: data.appointmentId,
      date: data.date instanceof Date ? data.date.toISOString() : String(data.date),
      startTime: data.startTime
        ? data.startTime instanceof Date
          ? data.startTime.toISOString()
          : String(data.startTime)
        : null,
      serviceName: data.serviceName ?? null,
      staffName: data.staffName ?? null,
      customerName: data.customerName ?? null,
    },
  };
}

/**
 * @param {{ userId: string, appointmentId: string, date: Date|string, startTime?: Date|string, serviceName?: string, reason?: string|null, customerName?: string }} data
 * @returns {{ userId: string, type: 'APPOINTMENT_CANCELLED', title: string, message: string, appointmentId: string, actionUrl: string, payload: Record<string, unknown> }}
 */
export function buildAppointmentCancelledNotification(data) {
  const dateStr = formatFrDate(data.date);
  const service = data.serviceName ? ` (${data.serviceName})` : "";
  const customer = data.customerName ? ` — ${data.customerName}` : "";
  const reason = data.reason ? ` Raison : ${data.reason}.` : "";
  return {
    userId: data.userId,
    type: "APPOINTMENT_CANCELLED",
    title: "Rendez-vous annulé",
    message: `Annulation rendez-vous${service} le ${dateStr}${customer}.${reason}`,
    appointmentId: data.appointmentId,
    actionUrl: "/dashboard/appointments",
    payload: {
      appointmentId: data.appointmentId,
      date: data.date instanceof Date ? data.date.toISOString() : String(data.date),
      startTime: data.startTime
        ? data.startTime instanceof Date
          ? data.startTime.toISOString()
          : String(data.startTime)
        : null,
      serviceName: data.serviceName ?? null,
      reason: data.reason ?? null,
      customerName: data.customerName ?? null,
    },
  };
}

/**
 * @param {{ userId: string, appointmentId: string, date: Date|string, startTime?: Date|string, serviceName?: string, customerName?: string }} data
 * @returns {{ userId: string, type: 'APPOINTMENT_NO_SHOW', title: string, message: string, appointmentId: string, actionUrl: string, payload: Record<string, unknown> }}
 */
export function buildAppointmentNoShowNotification(data) {
  const dateStr = formatFrDate(data.date);
  const service = data.serviceName ? ` (${data.serviceName})` : "";
  const customer = data.customerName ? ` — ${data.customerName}` : "";
  return {
    userId: data.userId,
    type: "APPOINTMENT_NO_SHOW",
    title: "Absence client",
    message: `Absence constatée${service} le ${dateStr}${customer}. Aucun remboursement émis.`,
    appointmentId: data.appointmentId,
    actionUrl: "/dashboard/appointments",
    payload: {
      appointmentId: data.appointmentId,
      date: data.date instanceof Date ? data.date.toISOString() : String(data.date),
      startTime: data.startTime
        ? data.startTime instanceof Date
          ? data.startTime.toISOString()
          : String(data.startTime)
        : null,
      serviceName: data.serviceName ?? null,
      customerName: data.customerName ?? null,
    },
  };
}

/**
 * @param {{ userId: string, reviewId: string, rating: number, customerName?: string, serviceName?: string, appointmentId?: string }} data
 * @returns {{ userId: string, type: 'GENERAL', title: string, message: string, actionUrl: string, payload: Record<string, unknown> }}
 */
export function buildReviewSubmittedNotification(data) {
  const service = data.serviceName ? ` pour ${data.serviceName}` : "";
  const customer = data.customerName ? ` de ${data.customerName}` : "";
  const stars = "★".repeat(data.rating) + "☆".repeat(5 - data.rating);
  return {
    userId: data.userId,
    type: "GENERAL",
    title: "Nouvel avis client",
    message: `Nouvel avis${customer}${service} : ${stars} (${data.rating}/5).`,
    actionUrl: "/dashboard/reviews",
    payload: {
      reviewId: data.reviewId,
      rating: data.rating,
      customerName: data.customerName ?? null,
      serviceName: data.serviceName ?? null,
      appointmentId: data.appointmentId ?? null,
    },
  };
}

/**
 * Resolve dashboard user ids that should be notified about an appointment event.
 *
 * Recipients:
 *   1. The assigned Staff member (via Staff.userId) — if staffId is provided and the staff is active.
 *   2. Every user with role OWNER or ADMIN (salon-level oversight).
 *
 * Deduplication is performed by id, which handles the case where the assigned
 * staff member is also an OWNER/ADMIN.
 *
 * @param {string|null|undefined} staffId - The assigned Staff.id (can be null for unassigned)
 * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient }} [options]
 * @returns {Promise<Array<string>>} Deduplicated array of User ids (dashboard users only)
 */
export async function getAppointmentNotificationRecipients(staffId, options) {
  const client = resolveClient(options);
  const ids = new Set();

  if (staffId) {
    const staff = await client.staff.findFirst({
      where: { id: staffId, isActive: true, isDeleted: false },
      select: { userId: true },
    });
    if (staff?.userId) ids.add(staff.userId);
  }

  const admins = await client.user.findMany({
    // isActive/isDeleted matter here: an admin who was deactivated or
    // soft-deleted (dashboard → Paramètres → Comptes administrateurs) must
    // stop receiving salon notifications and e-mails, otherwise "removing"
    // someone's access still leaves them on every booking/cancellation
    // thread. The Staff lookups above already filter this way.
    where: { role: { in: ["OWNER", "ADMIN"] }, isActive: true, isDeleted: false },
    select: { id: true },
  });
  for (const a of admins) ids.add(a.id);

  return Array.from(ids);
}

/**
 * Resolve dashboard user ids that should be notified about a review.
 *
 * Recipients:
 *   1. The assigned Staff member (via Staff.userId) — if staffId is provided and the staff is active.
 *   2. Every user with role OWNER or ADMIN (salon-level oversight).
 *
 * Deduplication is performed by id, which handles the case where the assigned
 * staff member is also an OWNER/ADMIN.
 *
 * @param {string|null|undefined} staffId - The assigned Staff.id (can be null for unassigned)
 * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient }} [options]
 * @returns {Promise<Array<string>>} Deduplicated array of User ids (dashboard users only)
 */
export async function getReviewNotificationRecipients(staffId, options) {
  return getAppointmentNotificationRecipients(staffId, options);
}

/**
 * Resolve dashboard user ids that should be notified about rental requests.
 *
 * Recipients:
 *   Every user with role OWNER or ADMIN (salon-level oversight).
 *
 * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient }} [options]
 * @returns {Promise<Array<string>>} Array of User ids (dashboard users only)
 */
export async function getRentalRequestNotificationRecipients(options) {
  return getSalonAdminNotificationRecipients(options);
}

/**
 * Resolve dashboard user ids for salon-wide events that have no assigned
 * staff member — a boutique order, a workshop/formation booking, a rental
 * request. Every active OWNER/ADMIN, nobody else.
 *
 * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient }} [options]
 * @returns {Promise<Array<string>>} Array of User ids (dashboard users only)
 */
export async function getSalonAdminNotificationRecipients(options) {
  const client = resolveClient(options);
  const admins = await client.user.findMany({
    // isActive/isDeleted matter here: an admin who was deactivated or
    // soft-deleted (dashboard → Paramètres → Comptes administrateurs) must
    // stop receiving salon notifications and e-mails, otherwise "removing"
    // someone's access still leaves them on every booking/cancellation
    // thread. The Staff lookups above already filter this way.
    where: { role: { in: ["OWNER", "ADMIN"] }, isActive: true, isDeleted: false },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

/**
 * Recipients for a workshop/formation booking: every active OWNER/ADMIN, plus
 * the session's animator when they are reachable AND allowed.
 *
 * Two constraints shape this, and both are easy to get wrong:
 *
 *  1. `Animator` is a public display profile (name, bio, avatar, socials) with
 *     no `userId` column — it is not an account. The only bridge to a
 *     dashboard user is a shared email address, so an animator without a
 *     matching active STAFF account simply cannot receive an in-app
 *     notification. Giving Animator a real user relation is the proper fix
 *     if this needs to be reliable.
 *
 *  2. A STAFF account is only notified when it has the matching reservation
 *     permission. Default staff receive FORMATION_RESERVATIONS, while an
 *     admin may separately grant WORKSHOP_RESERVATIONS for events/ateliers.
 *     The message carries the customer's name and what they booked, so this
 *     check prevents exposing reservation data to staff who cannot open the
 *     linked dashboard page.
 *
 * @param {string|null|undefined} animatorId - WorkshopSession/FormationSession animatorId
 * @param {string} permission - STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS | FORMATION_RESERVATIONS
 * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient }} [options]
 * @returns {Promise<Array<string>>} Deduplicated User ids
 */
export async function getActivityNotificationRecipients(animatorId, permission, options) {
  const client = resolveClient(options);
  const ids = new Set(await getSalonAdminNotificationRecipients(options));

  if (!animatorId) return Array.from(ids);

  const animator = await client.animator.findUnique({
    where: { id: animatorId },
    select: { email: true },
  });
  if (!animator?.email) return Array.from(ids);

  const staffUser = await client.user.findFirst({
    where: { email: animator.email, role: "STAFF", isActive: true, isDeleted: false },
    select: { id: true },
  });
  // Already covered as an admin, or no account behind this animator.
  if (!staffUser || ids.has(staffUser.id)) return Array.from(ids);

  const staff = await client.staff.findFirst({
    where: { userId: staffUser.id, isActive: true, isDeleted: false },
    select: { dashboardPermissions: true },
  });
  if (normalizeStaffPermissions(staff?.dashboardPermissions).includes(permission)) {
    ids.add(staffUser.id);
  }

  return Array.from(ids);
}

/**
 * Free-text that reaches a notification title/message from the catalogue or a
 * customer profile (workshop title, product name, full name) has no length
 * ceiling of its own, but createNotification* validates title <= 200 and
 * message <= 1000. These builders all run INSIDE the payment transaction, so
 * a single overlong title would throw there and roll back a Stripe payment
 * that was actually captured. Clamp the interpolated parts instead.
 */
function clampText(value, max) {
  const text = String(value ?? "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Salon-side notification: a boutique order was paid.
 *
 * The customer already gets their own PAYMENT_RECEIVED notification from
 * fulfillOrderPayment; this is the counterpart nobody was building, so an
 * online sale reached the dashboard only if someone happened to open the
 * orders list.
 */
export function buildOrderPaidNotification(data) {
  const fulfilment =
    data.fulfilmentMode === "SHIPPING_PREPAID"
      ? "à expédier"
      : data.fulfilmentMode === "PICKUP_PREPAID"
        ? "à préparer pour retrait"
        : "retrait en boutique";
  return {
    userId: data.userId,
    type: "PAYMENT_RECEIVED",
    title: `Commande n°${data.orderNumber} payée`,
    message: `${clampText(data.customerName, 80) || "Une cliente"} a payé €${Number(data.totalAmount).toFixed(2)} — commande n°${data.orderNumber} (${fulfilment}).`,
    actionUrl: `/dashboard/boutique/orders/${data.orderId}`,
    payload: {
      orderId: data.orderId,
      orderNumber: data.orderNumber,
      totalAmount: Number(data.totalAmount),
      fulfilmentMode: data.fulfilmentMode ?? null,
    },
  };
}

/** Salon-side notification: a boutique order was created and needs follow-up. */
export function buildOrderCreatedNotification(data) {
  const fulfilment =
    data.fulfilmentMode === "SHIPPING_PREPAID"
      ? "à expédier après paiement"
      : data.fulfilmentMode === "PICKUP_PREPAID"
        ? "à préparer pour retrait après paiement"
        : "à retirer et payer en boutique";
  return {
    userId: data.userId,
    type: "PAYMENT_PENDING",
    title: `Nouvelle commande n°${data.orderNumber}`,
    message: `${clampText(data.customerName, 80) || "Une cliente"} a créé une commande de €${Number(data.totalAmount).toFixed(2)} — ${fulfilment}.`,
    actionUrl: `/dashboard/boutique/orders/${data.orderId}`,
    payload: {
      orderId: data.orderId,
      orderNumber: data.orderNumber,
      totalAmount: Number(data.totalAmount),
      fulfilmentMode: data.fulfilmentMode ?? null,
    },
  };
}

/**
 * Salon-side notification: a workshop seat was booked and paid (deposit or
 * full — both mean the seat is now taken and money moved).
 */
export function buildWorkshopReservationPaidNotification(data) {
  const seats = data.seatsCount > 1 ? `${data.seatsCount} places` : "1 place";
  const kind = data.isDeposit ? "acompte" : "paiement";
  return {
    userId: data.userId,
    type: "PAYMENT_RECEIVED",
    title: `Atelier — ${seats} réservée${data.seatsCount > 1 ? "s" : ""}`,
    message: `${clampText(data.customerName, 80) || "Une cliente"} a réservé ${seats} pour « ${clampText(data.activityTitle, 120)} » — ${kind} de €${Number(data.paidAmount).toFixed(2)}.`,
    actionUrl: "/dashboard/workshops/reservations",
    payload: {
      reservationId: data.reservationId,
      activityTitle: data.activityTitle,
      seatsCount: data.seatsCount,
      paidAmount: Number(data.paidAmount),
      isDeposit: Boolean(data.isDeposit),
    },
  };
}

/** Salon-side notification: a workshop/event reservation was created. */
export function buildWorkshopReservationCreatedNotification(data) {
  const seats = data.seatsCount > 1 ? `${data.seatsCount} places` : "1 place";
  return {
    userId: data.userId,
    type: "PAYMENT_PENDING",
    title: `Atelier — réservation en attente`,
    message: `${clampText(data.customerName, 80) || "Une cliente"} a réservé ${seats} pour « ${clampText(data.activityTitle, 120)} » — paiement en attente.`,
    actionUrl: "/dashboard/workshops/reservations",
    payload: {
      reservationId: data.reservationId,
      activityTitle: data.activityTitle,
      seatsCount: data.seatsCount,
    },
  };
}

/** Salon-side notification: a formation seat was booked and paid. */
export function buildFormationReservationPaidNotification(data) {
  const seats = data.seatsCount > 1 ? `${data.seatsCount} places` : "1 place";
  const kind = data.isDeposit ? "acompte" : "paiement";
  return {
    userId: data.userId,
    type: "PAYMENT_RECEIVED",
    title: `Formation — ${seats} réservée${data.seatsCount > 1 ? "s" : ""}`,
    message: `${clampText(data.customerName, 80) || "Une cliente"} a réservé ${seats} pour « ${clampText(data.activityTitle, 120)} » — ${kind} de €${Number(data.paidAmount).toFixed(2)}.`,
    actionUrl: "/dashboard/formations/reservations",
    payload: {
      reservationId: data.reservationId,
      activityTitle: data.activityTitle,
      seatsCount: data.seatsCount,
      paidAmount: Number(data.paidAmount),
      isDeposit: Boolean(data.isDeposit),
    },
  };
}

/** Salon-side notification: a formation reservation was created. */
export function buildFormationReservationCreatedNotification(data) {
  const seats = data.seatsCount > 1 ? `${data.seatsCount} places` : "1 place";
  return {
    userId: data.userId,
    type: "PAYMENT_PENDING",
    title: "Formation — réservation en attente",
    message: `${clampText(data.customerName, 80) || "Une cliente"} a réservé ${seats} pour « ${clampText(data.activityTitle, 120)} » — paiement en attente.`,
    actionUrl: "/dashboard/formations/reservations",
    payload: {
      reservationId: data.reservationId,
      activityTitle: data.activityTitle,
      seatsCount: data.seatsCount,
    },
  };
}

/**
 * Resolve email addresses for dashboard users that should receive reservation emails.
 *
 * Recipients:
 *   1. The assigned Staff member (via Staff.userId) — if staffId is provided and the staff is active.
 *   2. Every user with role OWNER or ADMIN (salon-level oversight).
 *
 * Deduplication is performed by email, which handles the case where the assigned
 * staff member is also an OWNER/ADMIN.
 *
 * @param {string|null|undefined} staffId - The assigned Staff.id (can be null for unassigned)
 * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient }} [options]
 * @returns {Promise<Array<{email: string, fullName: string}>>} Deduplicated array of email recipients
 */
export async function getAppointmentEmailRecipients(staffId, options) {
  const client = resolveClient(options);
  const recipients = new Map(); // Map by email for deduplication

  if (staffId) {
    const staff = await client.staff.findFirst({
      where: { id: staffId, isActive: true, isDeleted: false },
      include: { user: { select: { email: true, fullName: true } } },
    });
    if (staff?.user?.email) {
      recipients.set(staff.user.email, { email: staff.user.email, fullName: staff.user.fullName });
    }
  }

  const admins = await client.user.findMany({
    // isActive/isDeleted matter here: an admin who was deactivated or
    // soft-deleted (dashboard → Paramètres → Comptes administrateurs) must
    // stop receiving salon notifications and e-mails, otherwise "removing"
    // someone's access still leaves them on every booking/cancellation
    // thread. The Staff lookups above already filter this way.
    where: { role: { in: ["OWNER", "ADMIN"] }, isActive: true, isDeleted: false },
    select: { email: true, fullName: true },
  });
  for (const admin of admins) {
    if (admin.email) {
      recipients.set(admin.email, { email: admin.email, fullName: admin.fullName });
    }
  }

  return Array.from(recipients.values());
}

/**
 * @param {{ userId: string, rentalRequestId: string, rentalType?: string, applicantName?: string }} data
 * @returns {{ userId: string, type: 'GENERAL', title: string, message: string, actionUrl: string, payload: Record<string, unknown> }}
 */
export function buildRentalRequestSubmittedNotification(data) {
  const rentalType = data.rentalType ? ` (${data.rentalType})` : "";
  const applicant = data.applicantName ? ` de ${data.applicantName}` : "";
  return {
    userId: data.userId,
    type: "GENERAL",
    title: "Nouvelle demande de location",
    message: `Nouvelle demande de location${rentalType}${applicant}.`,
    actionUrl: "/dashboard/rental-requests",
    payload: {
      rentalRequestId: data.rentalRequestId,
      rentalType: data.rentalType ?? null,
      applicantName: data.applicantName ?? null,
    },
  };
}



/* ─── PUBLIC API ────────────────────────────────────────────────────── */

/**
 * Create one notification.
 *
 * Use this from any trusted server-side code (Stripe webhook handlers,
 * appointment CRUD, boutique order lifecycle, workshop/formation reservation
 * confirmations, newsletter internal confirmations, cron reminder jobs, etc).
 *
 * Always prefer this + `options.tx` when the triggering event is itself
 * inside a Prisma transaction — that guarantees the notification only exists
 * if the triggering event actually commits.
 *
 * @param {object} input
 * @param {string} input.userId              - Recipient user id
 * @param {string} input.type                - NotificationType enum value
 * @param {string} input.title               - Short summary (max 200 chars)
 * @param {string} input.message             - Longer body (max 1000 chars)
 * @param {string} [input.actionUrl]         - Optional deep link the user
 *                                              follows when tapping the notif
 * @param {string} [input.appointmentId]     - Optional related appointment
 * @param {string} [input.status]            - PENDING | SENT | READ, default PENDING
 * @param {boolean} [input.isRead]           - Mark as read at creation? (rare)
 * @param {Date | string} [input.sentAt]     - Optional "sent" timestamp
 * @param {Record<string, unknown>} [input.payload] - Extensibility slot for
 *                                              future template-driven rendering
 * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient }} [options]
 *        Pass `options.tx` to bind the write to an existing Prisma
 *        transaction. If omitted, the write runs on the global client and
 *        auto-commits.
 * @returns {Promise<object>} Serialized notification row that was created.
 */
export async function createNotification(input, options) {
  const parsed = createNotificationSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const error = new Error("VALIDATION_ERROR");
    // @ts-ignore
    error.fieldErrors = fieldErrors;
    throw error;
  }

  const data = parsed.data;
  // payload is accepted for future extensibility; intentionally not persisted
  // today — remove the _ prefix once a template engine consumes it.
  const { payload: _payload, ...persistable } = data;

  const client = resolveClient(options);
  const created = await client.notification.create({
    data: {
      userId: persistable.userId,
      type: persistable.type,
      title: persistable.title,
      message: persistable.message,
      actionUrl: persistable.actionUrl ?? null,
      appointmentId: persistable.appointmentId ?? null,
      status: persistable.status,
      isRead: persistable.isRead,
      sentAt: persistable.sentAt ?? null,
    },
    select: NOTIFICATION_SELECT_FIELDS,
  });

  const serialized = serializeNotification(created);
  await triggerNotificationEvent(persistable.userId, "notification:created", {
    notification: serialized,
  });

  return serialized;
}

/**
 * Batch-create multiple notifications in a single Prisma call.
 *
 * Useful for broadcast-type flows: "notify all admins that a newsletter was
 * sent", "notify every animator that their workshop seats dropped below 3",
 * "notify a waiting list", etc. The batch is limited by the Zod schema to
 * 500 rows / call — split larger broadcasts into chunks.
 *
 * @param {Array<object>} inputs    - One object per notification, same
 *                                    shape as createNotification()'s `input`
 * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient }} [options]
 * @returns {Promise<{ count: number, items: object[] }>}
 */
export async function createNotificationsBulk(inputs, options) {
  const parsed = createNotificationsBulkSchema.safeParse(inputs);
  if (!parsed.success) {
    const error = new Error("VALIDATION_ERROR");
    // @ts-ignore
    error.fieldErrors = parsed.error.flatten().fieldErrors;
    throw error;
  }

  const rows = parsed.data.map((item) => {
    // payload intentionally dropped — see comment in createNotification()
    const { payload: _p, ...persistable } = item;
    return {
      userId: persistable.userId,
      type: persistable.type,
      title: persistable.title,
      message: persistable.message,
      actionUrl: persistable.actionUrl ?? null,
      appointmentId: persistable.appointmentId ?? null,
      status: persistable.status,
      isRead: persistable.isRead,
      sentAt: persistable.sentAt ?? null,
    };
  });

  const client = resolveClient(options);

  // createManyAndReturn (Prisma 5.14+, this project is on 6.x) inserts and
  // hands back the actual created rows in one call — no ambiguity about
  // which rows were just inserted. The previous approach (createMany, then
  // re-querying "recent rows for these userIds") could pick up a DIFFERENT
  // concurrent bulk-create's rows for the same recipient within the same
  // ~1 minute window, silently broadcasting the wrong notification (or none
  // at all) over the realtime channel.
  const createdRows = await client.notification.createManyAndReturn({
    data: rows,
    skipDuplicates: false,
    select: NOTIFICATION_SELECT_FIELDS,
  });

  const serializedItems = createdRows.map((row) => serializeNotification(row));

  await Promise.all(
    createdRows.map((rawRow, i) =>
      triggerNotificationEvent(rawRow.userId, "notification:created", {
        notification: serializedItems[i],
      })
    )
  );

  return {
    count: createdRows.length,
    items: serializedItems,
  };
}

/**
 * Return a paginated slice of a user's notifications, newest first.
 *
 * Uses the Prisma schema indexes: `@@index([userId])` + `@@index([createdAt])`
 * for the order, and `@@index([userId, isRead])` when filterIsRead is set.
 *
 * Pagination is cursor-based. Pass the `pageInfo.endCursor` returned by the
 * previous call as `cursor` to get the next page. Cursor encoding uses
 * `(createdAt, id)` — two notifs with identical timestamps still have a
 * deterministic total order because id breaks ties.
 *
 * @param {object} params
 * @param {string} params.userId           - Which user's list to fetch
 * @param {number} [params.pageSize=20]    - Rows per page, clamped 1–100
 * @param {string | null} [params.cursor]  - Opaque cursor from previous call
 * @param {boolean | null} [params.filterIsRead] - true=read only, false=unread only, null=all
 * @returns {Promise<{ items: object[], pageInfo: { hasNextPage: boolean, endCursor: string | null } }>}
 */
export async function listUserNotifications(params) {
  const parsed = listUserNotificationsSchema.safeParse(params);
  if (!parsed.success) {
    const error = new Error("VALIDATION_ERROR");
    // @ts-ignore
    error.fieldErrors = parsed.error.flatten().fieldErrors;
    throw error;
  }

  const { userId, pageSize, cursor, filterIsRead } = parsed.data;

  const where = { userId };
  if (filterIsRead === true) where.isRead = true;
  else if (filterIsRead === false) where.isRead = false;

  const cursorDecoded = cursor ? decodeCursor(cursor) : null;
  const prismaCursor = cursorDecoded
    ? { id_createdAt: { id: cursorDecoded.id, createdAt: cursorDecoded.createdAt } }
    : undefined;

  if (cursorDecoded && prismaCursor) {
    where.OR = [
      { createdAt: { lt: cursorDecoded.createdAt } },
      {
        createdAt: cursorDecoded.createdAt,
        id: { lt: cursorDecoded.id },
      },
    ];
    // When we have a cursor, Prisma's native `cursor` option expects the row
    // itself to exist; using the manual OR + skip: 0 gives identical behavior
    // to cursor pagination but tolerates the edge case of the anchor row
    // having been deleted between calls. To keep the simple deterministic
    // "strictly before" semantics we use the manual OR above; we also still
    // pass `prismaCursor` only if the referenced row actually still exists —
    // to check that, do a cheap existence probe. Use OR-based skip instead.
  }

  // Request pageSize + 1 so we can set hasNextPage without a separate COUNT.
  const take = pageSize + 1;

  const rows = await prisma.notification.findMany({
    where,
    take,
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: NOTIFICATION_SELECT_FIELDS,
  });

  const hasNextPage = rows.length > pageSize;
  const trimmed = hasNextPage ? rows.slice(0, pageSize) : rows;
  const lastRow = trimmed[trimmed.length - 1];

  return {
    items: trimmed.map((row) => serializeNotification(row)),
    pageInfo: {
      hasNextPage,
      endCursor: lastRow ? encodeCursor(lastRow.createdAt, lastRow.id) : null,
    },
  };
}

async function cursorRowStillExists(decoded) {
  if (!decoded) return false;
  const hit = await prisma.notification.findUnique({
    where: { id: decoded.id },
    select: { id: true },
  });
  return Boolean(hit);
}

/**
 * Count how many notifications a user has not yet read.
 *
 * Uses the dedicated compound index `@@index([userId, isRead])` — this is an
 * index-only scan in Postgres; extremely fast even at very high row counts.
 *
 * @param {string} userId
 * @returns {Promise<number>} Number of unread notifications for the user.
 */
export async function countUnreadUserNotifications(userId) {
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    const error = new Error("VALIDATION_ERROR");
    // @ts-ignore
    error.fieldErrors = { userId: ["L'utilisateur est obligatoire."] };
    throw error;
  }

  return prisma.notification.count({
    where: { userId, isRead: false },
  });
}

/**
 * Mark a single notification as read, scoped to a specific user.
 *
 * Uses a single `updateMany` where the WHERE clause includes BOTH the PK AND
 * the userId. This is a "claim" pattern (see docs/AI_RULES.md §1.2 Pattern A):
 *   - Ownership violation → 0 rows affected → returns updated=false.
 *   - Concurrent mark-read + delete race → exactly one "wins" → never a
 *     phantom double-write of side effects.
 * Never use a pattern like `findUnique({id}) → if userId matches → update`.
 *
 * The claim is intentionally not wrapped in a transaction; there are no
 * side-effects beyond updating this one row, and updateMany is itself
 * atomic.
 *
 * Status transition: PENDING/SENT → READ. If already READ, stays READ.
 *
 * @param {string} userId              - Owner (the caller must prove this)
 * @param {string} notificationId      - Notification PK
 * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient }} [options]
 * @returns {Promise<{ updated: boolean, notification: object | null }>}
 *          `updated: true` if a row was actually changed. When true the
 *          serialized post-update notification is also returned.
 */
export async function markNotificationAsRead(userId, notificationId, options) {
  const parsed = notificationIdSchema.safeParse({ notificationId });
  if (!parsed.success || !userId || typeof userId !== "string") {
    const error = new Error("VALIDATION_ERROR");
    // @ts-ignore
    error.fieldErrors = {
      ...(parsed.success ? {} : parsed.error.flatten().fieldErrors),
      ...(!userId || typeof userId !== "string" ? { userId: ["L'utilisateur est obligatoire."] } : {}),
    };
    throw error;
  }

  const client = resolveClient(options);
  const claim = await client.notification.updateMany({
    where: { id: notificationId, userId, isRead: false },
    data: { isRead: true, status: "READ" },
  });

  const updated = claim.count > 0;
  let notification = null;
  if (updated) {
    const row = await client.notification.findUnique({
      where: { id: notificationId },
      select: NOTIFICATION_SELECT_FIELDS,
    });
    notification = serializeNotification(row);
    await triggerNotificationEvent(userId, "notification:read", {
      notificationId,
      notification,
    });
  }

  return { updated, notification };
}

/**
 * Mark EVERY notification for a user as read in one atomic statement.
 *
 * Uses a single `updateMany` against `{ userId, isRead: false }` — Postgres
 * does this in one statement, no app-level iteration.
 *
 * @param {string} userId
 * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient }} [options]
 * @returns {Promise<{ updatedCount: number }>} How many rows were flipped.
 */
export async function markAllNotificationsAsRead(userId, options) {
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    const error = new Error("VALIDATION_ERROR");
    // @ts-ignore
    error.fieldErrors = { userId: ["L'utilisateur est obligatoire."] };
    throw error;
  }

  const client = resolveClient(options);
  const result = await client.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, status: "READ" },
  });

  if (result.count > 0) {
    await triggerNotificationEvent(userId, "notification:all-read", {
      updatedCount: result.count,
    });
  }

  return { updatedCount: result.count };
}

/**
 * Delete a single notification, scoped to its owner.
 *
 * Same ownership/atomicity pattern as markNotificationAsRead: a single
 * `deleteMany` claim that includes `{ id, userId }` in WHERE. You cannot
 * delete another user's notification even if you guess their CUID — the
 * count comes back 0 and a generic "not found" is reported one layer up.
 *
 * Hard delete by design: notification rows are append-only history of
 * transient events; soft delete would grow the table forever without adding
 * value (unlike invoices/orders/Products which are permanent financial
 * records, not UI notifications).
 *
 * @param {string} userId
 * @param {string} notificationId
 * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient }} [options]
 * @returns {Promise<{ deleted: boolean }>}
 */
export async function deleteNotification(userId, notificationId, options) {
  const parsed = notificationIdSchema.safeParse({ notificationId });
  if (!parsed.success || !userId || typeof userId !== "string") {
    const error = new Error("VALIDATION_ERROR");
    // @ts-ignore
    error.fieldErrors = {
      ...(parsed.success ? {} : parsed.error.flatten().fieldErrors),
      ...(!userId || typeof userId !== "string" ? { userId: ["L'utilisateur est obligatoire."] } : {}),
    };
    throw error;
  }

  const client = resolveClient(options);
  const claim = await client.notification.deleteMany({
    where: { id: notificationId, userId },
  });

  if (claim.count > 0) {
    await triggerNotificationEvent(userId, "notification:deleted", {
      notificationId,
    });
  }

  return { deleted: claim.count > 0 };
}
