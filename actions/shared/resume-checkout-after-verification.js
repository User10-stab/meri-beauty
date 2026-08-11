"use server";

import { resumeOrderAfterVerification } from "@/actions/boutique/orders";
import { createWorkshopReservationCheckoutSession } from "@/actions/workshops/create-workshop-reservation";
import { createFormationReservationCheckoutSession } from "@/actions/formations/create-formation-reservation";

/**
 * Just the "start payment" half of checkout resume, with no credentials
 * side-effect. Called from verifyEmail() (actions/auth/verify-email.js)
 * right after a checkout-issued token is confirmed, and again from the
 * manual "Réessayer le paiement" fallback if that automatic attempt fails
 * (e.g. a Stripe API hiccup) — the account is already verified and
 * credentialed by that point, so retrying shouldn't regenerate/resend a
 * second password. Takes no userId: it only ever resumes a specific
 * resumeId (an order/reservation), which the receiving action re-validates
 * on its own — nothing here can overwrite account credentials.
 *
 * @param {{ resumeType: "ORDER"|"WORKSHOP"|"FORMATION", resumeId: string }} params
 */
export async function retryCheckoutSession({ resumeType, resumeId }) {
  switch (resumeType) {
    case "ORDER":
      return resumeOrderAfterVerification(resumeId);
    case "WORKSHOP":
      return createWorkshopReservationCheckoutSession(resumeId);
    case "FORMATION":
      return createFormationReservationCheckoutSession(resumeId);
    default:
      return { success: false, message: "Type de réservation inconnu." };
  }
}
