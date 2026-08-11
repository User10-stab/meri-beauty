import { z } from "zod";

const NOTIFICATION_TITLE_MAX_LENGTH = 200;
const NOTIFICATION_MESSAGE_MAX_LENGTH = 1000;
const NOTIFICATION_ACTION_URL_MAX_LENGTH = 500;
const NOTIFICATION_DEFAULT_PAGE_SIZE = 20;
const NOTIFICATION_MAX_PAGE_SIZE = 100;

/**
 * All notification types as defined in the Prisma enum `NotificationType`.
 * Keep this list in sync with the schema whenever the enum is extended.
 */
const NOTIFICATION_TYPES = [
  "APPOINTMENT_CREATED",
  "APPOINTMENT_CONFIRMED",
  "APPOINTMENT_CANCELLED",
  "APPOINTMENT_REMINDER",
  "PAYMENT_RECEIVED",
  "PAYMENT_PENDING",
  "GENERAL",
];

const NOTIFICATION_STATUSES = [
  "PENDING",
  "SENT",
  "READ",
];

const baseCreateFields = z.object({
  userId: z
    .string({ required_error: "L'utilisateur est obligatoire." })
    .min(1, "L'utilisateur est obligatoire."),
  type: z.enum(NOTIFICATION_TYPES, {
    required_error: "Le type de notification est obligatoire.",
    invalid_type_error: "Type de notification invalide.",
  }),
  title: z
    .string({ required_error: "Le titre est obligatoire." })
    .trim()
    .min(1, "Le titre ne peut pas être vide.")
    .max(
      NOTIFICATION_TITLE_MAX_LENGTH,
      `Le titre ne peut pas dépasser ${NOTIFICATION_TITLE_MAX_LENGTH} caractères.`
    ),
  message: z
    .string({ required_error: "Le message est obligatoire." })
    .trim()
    .min(1, "Le message ne peut pas être vide.")
    .max(
      NOTIFICATION_MESSAGE_MAX_LENGTH,
      `Le message ne peut pas dépasser ${NOTIFICATION_MESSAGE_MAX_LENGTH} caractères.`
    ),
  actionUrl: z
    .string()
    .trim()
    .max(
      NOTIFICATION_ACTION_URL_MAX_LENGTH,
      `L'URL d'action ne peut pas dépasser ${NOTIFICATION_ACTION_URL_MAX_LENGTH} caractères.`
    )
    // Accept both absolute URLs and relative dashboard paths (e.g. /dashboard/appointments)
    .refine(
      (v) => {
        const value = (v ?? "").trim();
        if (!value) return true;
        if (value.startsWith("/")) return true;
        try {
          // URL parsing check for absolute URLs
          new URL(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: "L'URL d'action est invalide." }
    )
    .optional()
    .or(z.literal(""))
    .transform((v) => {
      const normalized = v?.trim();
      return normalized ? normalized : null;
    }),
  appointmentId: z
    .string()
    .min(1, "L'identifiant du rendez-vous est invalide.")
    .optional()
    .nullable(),
  status: z
    .enum(NOTIFICATION_STATUSES, {
      invalid_type_error: "Statut de notification invalide.",
    })
    .default("PENDING"),
  isRead: z.coerce.boolean().default(false),
  sentAt: z.coerce.date().optional().nullable(),
  /**
   * Optional extensibility slot.
   * Reserved for future notification-template / variable-interpolation use
   * (e.g. `{ orderNumber, customerName, serviceName }`). Not stored in the
   * DB today — accepted by the schema so callers can pass payloads now and
   * the service can be extended later to use them for template rendering /
   * email generation without changing caller signatures.
   */
  payload: z.record(z.unknown()).optional().nullable(),
});

/**
 * Validates a single notification creation request.
 * Used by the notification service itself when creating rows.
 */
export const createNotificationSchema = baseCreateFields;

/**
 * Validates a bulk notification creation request.
 * Enforces a sane per-call batch size cap to avoid blowing up transaction time.
 */
export const createNotificationsBulkSchema = z
  .array(baseCreateFields, {
    required_error: "La liste des notifications est obligatoire.",
    invalid_type_error: "La liste des notifications est invalide.",
  })
  .min(1, "Au moins une notification est obligatoire.")
  .max(500, "Vous ne pouvez pas créer plus de 500 notifications à la fois.");

/**
 * Pagination + filter inputs for `listUserNotifications`.
 * Cursor-based to avoid the OFFSET deep-page performance cliff; size capped
 * to prevent accidental table scans.
 */
export const listUserNotificationsSchema = z.object({
  userId: z
    .string({ required_error: "L'utilisateur est obligatoire." })
    .min(1, "L'utilisateur est obligatoire."),
  pageSize: z.coerce
    .number({ invalid_type_error: "Taille de page invalide." })
    .int()
    .min(1, "La taille de page doit être au moins de 1.")
    .max(
      NOTIFICATION_MAX_PAGE_SIZE,
      `La taille de page ne peut pas dépasser ${NOTIFICATION_MAX_PAGE_SIZE}.`
    )
    .default(NOTIFICATION_DEFAULT_PAGE_SIZE),
  /**
   * Opaque cursor, produced by a previous call's `pageInfo.endCursor`.
   * When provided, returns the page of results that comes immediately after it.
   */
  cursor: z
    .string()
    .min(1, "Le curseur de pagination est invalide.")
    .optional()
    .nullable(),
  /** isRead filter: true = only read, false = only unread, null/undefined = all */
  filterIsRead: z
    .boolean()
    .optional()
    .nullable(),
});

/**
 * A single notification identifier — used by mark-as-read and delete actions.
 */
export const notificationIdSchema = z.object({
  notificationId: z
    .string({ required_error: "L'identifiant de notification est obligatoire." })
    .min(1, "L'identifiant de notification est obligatoire."),
});

export {
  NOTIFICATION_TITLE_MAX_LENGTH,
  NOTIFICATION_MESSAGE_MAX_LENGTH,
  NOTIFICATION_ACTION_URL_MAX_LENGTH,
  NOTIFICATION_DEFAULT_PAGE_SIZE,
  NOTIFICATION_MAX_PAGE_SIZE,
  NOTIFICATION_TYPES,
  NOTIFICATION_STATUSES,
};
