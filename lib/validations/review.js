import { z } from "zod";
import { REVIEW_COMMENT_MAX_LENGTH } from "@/lib/review-eligibility";

export const createReviewSchema = z.object({
  appointmentId: z.string().min(1, "Rendez-vous manquant."),
  rating: z.coerce.number().int().min(1, "La note est requise.").max(5, "La note doit être comprise entre 1 et 5."),
  comment: z
    .string()
    .max(REVIEW_COMMENT_MAX_LENGTH, `Le commentaire ne peut pas dépasser ${REVIEW_COMMENT_MAX_LENGTH} caractères.`)
    .optional()
    .or(z.literal(""))
    .transform((value) => {
      const normalized = value?.trim();
      return normalized ? normalized : null;
    }),
});
