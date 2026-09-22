import { z } from "zod";
import { REVIEW_COMMENT_MAX_LENGTH } from "@/lib/review-eligibility";

const reviewCommentSchema = z
  .string()
  .max(REVIEW_COMMENT_MAX_LENGTH, `Le commentaire est limité à ${REVIEW_COMMENT_MAX_LENGTH} caractères.`)
  .optional()
  .or(z.literal(""))
  .transform((value) => {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  });

export const createReviewSchema = z.object({
  appointmentId: z.string().min(1, "Rendez-vous manquant."),
  rating: z.coerce.number().int().min(1, "La note est requise.").max(5, "La note doit être comprise entre 1 et 5."),
  comment: reviewCommentSchema,
});

// Shared by workshop and formation reservation reviews — both take the same
// shape, just a reservationId instead of an appointmentId.
export const createReservationReviewSchema = z.object({
  reservationId: z.string().min(1, "Réservation manquante."),
  rating: z.coerce.number().int().min(1, "La note est requise.").max(5, "La note doit être comprise entre 1 et 5."),
  comment: reviewCommentSchema,
});
