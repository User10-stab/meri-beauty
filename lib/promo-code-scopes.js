/**
 * Client-safe promo-code constants (no Prisma import) — shared by the
 * validation schema, the admin pages and lib/promo-codes.js.
 */
export const PROMO_CODE_SCOPES = ["BOUTIQUE", "APPOINTMENT", "WORKSHOP", "FORMATION"];

export const PROMO_CODE_SCOPE_LABELS = {
  BOUTIQUE: "Boutique",
  APPOINTMENT: "Rendez-vous",
  WORKSHOP: "Ateliers",
  FORMATION: "Formations",
};
