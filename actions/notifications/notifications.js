"use server";

import { auth } from "@/auth";
import {
  listUserNotifications,
  countUnreadUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
} from "@/lib/notifications";
import { listUserNotificationsSchema, notificationIdSchema } from "@/lib/validations/notification";

const GENERIC_FORBIDDEN_MESSAGE = "Vous n'êtes pas autorisé à effectuer cette action.";
const GENERIC_NOT_FOUND_MESSAGE = "Notification introuvable.";
const AUTH_REQUIRED_MESSAGE = "Authentification requise. Veuillez vous connecter.";

/**
 * Extracts the authenticated user id from the NextAuth session.
 * Returns null if there is no session, no user, or no id.
 *
 * Every exported server action calls this FIRST before any DB access,
 * matching the Pattern B ownership-check rule defined in
 * docs/AI_RULES.md § 1.3 (and the reference implementations in
 * actions/appointment/manage-appointment.js + actions/boutique/orders.js).
 *
 * Ownership is then re-verified at the lib layer via the `userId` passed
 * to each scoped operation (updateMany/deleteMany with WHERE including both
 * the PK and the owner userId). Two layers of defence, not one.
 *
 * @returns {Promise<string | null>}
 */
async function getAuthenticatedUserId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * Maps a VALIDATION_ERROR thrown by the service layer into a safe,
 * user-facing action response envelope. Unknown errors fall through to a
 * generic 500-style response so internal error messages are never leaked.
 *
 * @param {unknown} err
 * @param {string} fallbackMessage
 * @returns {{ success: boolean, message: string, errors?: Record<string, string | null | undefined> }}
 */
function handleServiceError(err, fallbackMessage) {
  if (err && typeof err === "object" && err.message === "VALIDATION_ERROR") {
    const rawFieldErrors =
      (/** @type {{ fieldErrors?: Record<string, string[]> }} */ (err)).fieldErrors ?? {};
    const errors = {};
    for (const key of Object.keys(rawFieldErrors)) {
      errors[key] = rawFieldErrors[key]?.[0] ?? null;
    }
    return {
      success: false,
      message: "Veuillez corriger les erreurs du formulaire.",
      errors,
    };
  }
  console.error("[notifications action]", err);
  return { success: false, message: fallbackMessage };
}

/* ─── PUBLIC SERVER ACTIONS ──────────────────────────────────────────── */
/*                                                                       */
/* INTENTIONALLY ABSENT: createNotification() action.                    */
/*                                                                       */
/* Notifications are system-generated only. They MUST be produced by     */
/* trusted server-side modules (webhooks, transactions inside actions,  */
/* cron jobs) through lib/notifications.js service calls, where the     */
/* caller is already inside a trusted context. A client-callable         */
/* createNotification server action would be an abuse vector: even with */
/* ownership checks, it would let any user script their own spam feed   */
/* into their own notifications list, or worse, guess another user's    */
/* id and trigger a (blocked but still logged) flood of writes.         */
/*                                                                       */
/* The ADMIN / internal broadcast case is handled by having the ADMIN   */
/* code path call createNotification(...) / createNotificationsBulk(...) */
/* DIRECTLY from inside a server action that already has its own admin- */
/* role gate and its own business-validated inputs, not from a generic  */
/* "create notification" action endpoint.                                */
/* ───────────────────────────────────────────────────────────────────── */

/**
 * List the calling user's notifications with cursor pagination.
 *
 * Returns a page of results, newest first, with an opaque cursor the
 * client passes back for the next page.
 *
 * @param {{ pageSize?: number, cursor?: string | null, filterIsRead?: boolean | null }} params
 * @returns {Promise<{ success: boolean, message: string, data?: { items: object[], pageInfo: { hasNextPage: boolean, endCursor: string | null } }, errors?: Record<string, string | null | undefined> }>}
 */
export async function getUserNotifications(params = {}) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, message: AUTH_REQUIRED_MESSAGE };
  }

  // Coerce params first so Zod can coerce numeric strings etc.
  const parsedParams = listUserNotificationsSchema.safeParse({
    userId,
    pageSize: params.pageSize,
    cursor: params.cursor,
    filterIsRead: params.filterIsRead,
  });
  if (!parsedParams.success) {
    const fieldErrors = parsedParams.error.flatten().fieldErrors;
    const errors = {};
    for (const key of Object.keys(fieldErrors)) {
      errors[key] = fieldErrors[key]?.[0] ?? null;
    }
    return {
      success: false,
      message: "Paramètres de pagination invalides.",
      errors,
    };
  }

  try {
    const result = await listUserNotifications(parsedParams.data);
    return {
      success: true,
      message: "Notifications chargées.",
      data: result,
    };
  } catch (err) {
    return handleServiceError(err, "Impossible de charger les notifications.");
  }
}

/**
 * Count how many unread notifications the calling user currently has.
 *
 * Used by the future in-app notification badge. Kept as a lightweight
 * dedicated call rather than piggy-backing on list queries because the
 * badge will be re-fetched frequently without necessarily pulling a new
 * list page.
 *
 * @returns {Promise<{ success: boolean, message: string, data?: { count: number } }>}
 */
export async function getUnreadCount() {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, message: AUTH_REQUIRED_MESSAGE };
  }

  try {
    const count = await countUnreadUserNotifications(userId);
    return {
      success: true,
      message: "Compte des non lus chargé.",
      data: { count },
    };
  } catch (err) {
    return handleServiceError(err, "Impossible de compter les notifications non lues.");
  }
}

/**
 * Mark a single notification as read.
 *
 * Ownership is enforced at the data layer via the service function's
 * WHERE clause (id + userId). Wrong-owner calls come back with
 * `updated: false`, which we translate into a generic "not found" error
 * so CUID enumerators get no signal about whether a given id exists for
 * another user (IDOR via error-message).
 *
 * @param {{ notificationId: string }} input
 * @returns {Promise<{ success: boolean, message: string, data?: { notification: object | null }, errors?: Record<string, string | null | undefined> }>}
 */
export async function markAsRead(input) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, message: AUTH_REQUIRED_MESSAGE };
  }

  const parsed = notificationIdSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const errors = {};
    for (const key of Object.keys(fieldErrors)) {
      errors[key] = fieldErrors[key]?.[0] ?? null;
    }
    return {
      success: false,
      message: "Identifiant de notification invalide.",
      errors,
    };
  }

  try {
    const { notificationId } = parsed.data;
    const result = await markNotificationAsRead(userId, notificationId);
    if (!result.updated) {
      return { success: false, message: GENERIC_NOT_FOUND_MESSAGE };
    }
    return {
      success: true,
      message: "Notification marquée comme lue.",
      data: { notification: result.notification },
    };
  } catch (err) {
    return handleServiceError(err, "Impossible de marquer la notification comme lue.");
  }
}

/**
 * Mark EVERY notification for the calling user as read in one call.
 *
 * Executed as a single atomic updateMany; no per-row iteration on the app
 * server. `updatedCount` is returned so the UI can show a confirmation
 * toast like "X notifications marquées comme lues."
 *
 * @returns {Promise<{ success: boolean, message: string, data?: { updatedCount: number } }>}
 */
export async function markAllAsRead() {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, message: AUTH_REQUIRED_MESSAGE };
  }

  try {
    const result = await markAllNotificationsAsRead(userId);
    return {
      success: true,
      message:
        result.updatedCount > 0
          ? `${result.updatedCount} notification(s) marquée(s) comme lue(s).`
          : "Aucune notification non lue.",
      data: { updatedCount: result.updatedCount },
    };
  } catch (err) {
    return handleServiceError(err, "Impossible de marquer toutes les notifications comme lues.");
  }
}

/**
 * Delete a single notification belonging to the calling user.
 *
 * Same ownership + IDOR-hardening strategy as markAsRead: generic
 * "not found" on claim count 0, no distinction between "doesn't exist"
 * vs "exists but belongs to someone else."
 *
 * @param {{ notificationId: string }} input
 * @returns {Promise<{ success: boolean, message: string, errors?: Record<string, string | null | undefined> }>}
 */
export async function deleteNotificationAction(input) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, message: AUTH_REQUIRED_MESSAGE };
  }

  const parsed = notificationIdSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const errors = {};
    for (const key of Object.keys(fieldErrors)) {
      errors[key] = fieldErrors[key]?.[0] ?? null;
    }
    return {
      success: false,
      message: "Identifiant de notification invalide.",
      errors,
    };
  }

  try {
    const { notificationId } = parsed.data;
    const result = await deleteNotification(userId, notificationId);
    if (!result.deleted) {
      return { success: false, message: GENERIC_NOT_FOUND_MESSAGE };
    }
    return { success: true, message: "Notification supprimée." };
  } catch (err) {
    return handleServiceError(err, "Impossible de supprimer la notification.");
  }
}
