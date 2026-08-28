const REVIEW_COMMENT_MAX_LENGTH = 0; // 0 = no limit (unlimited comment textarea)

/**
 * Shared server-side predicates for appointment review eligibility.
 */
export function getAppointmentReviewBlockReason(appointment, userId) {
  if (!userId) return "AUTH_REQUIRED";
  if (!appointment) return "NOT_FOUND";
  if (appointment.userId !== userId) return "FORBIDDEN";
  if (appointment.status !== "COMPLETED") return "NOT_COMPLETED";
  if (appointment.review) return "ALREADY_REVIEWED";
  return null;
}

export function canReviewAppointment(appointment, userId) {
  return getAppointmentReviewBlockReason(appointment, userId) === null;
}

export const REVIEW_ERRORS = {
  AUTH_REQUIRED: "Vous devez être connecté(e) pour laisser un avis.",
  NOT_FOUND: "Rendez-vous introuvable.",
  FORBIDDEN: "Vous ne pouvez pas laisser un avis sur ce rendez-vous.",
  NOT_COMPLETED: "Vous pourrez laisser un avis une fois le rendez-vous terminé.",
  ALREADY_REVIEWED: "Un avis a déjà été laissé pour ce rendez-vous.",
};

export { REVIEW_COMMENT_MAX_LENGTH };
