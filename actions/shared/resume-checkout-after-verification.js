"use server";

import { resumeOrderAfterVerification } from "@/actions/boutique/orders";
import { createWorkshopReservationCheckoutSession } from "@/actions/workshops/create-workshop-reservation";
import { createFormationReservationCheckoutSession } from "@/actions/formations/create-formation-reservation";
import { verifyResumeCheckoutToken } from "@/lib/resume-checkout-token";

/**
 * Manual "Réessayer le paiement" entry point, reachable from the client after
 * e-mail verification. This is a public "use server" action: without a proof
 * of ownership, any caller could pass an arbitrary cuid and resume — i.e.
 * harvest another customer's pickup code (returned in the on-site success
 * URL) or spam them with pickup-confirmation e-mails.
 *
 * At resume time there is NO authenticated session yet (verifyEmail confirms
 * the address and e-mails credentials but never signs the user in), so the
 * ownership proof can't be auth() + resource.userId. It is the signed
 * `resumeToken` instead — minted only by verifyEmail() from the validated
 * EmailVerificationToken row the instant the address was confirmed, and bound
 * to (resumeType, resumeId, email) over AUTH_SECRET. The inline resume inside
 * verifyEmail() passes the same token, so both paths go through this one
 * guarded dispatcher.
 *
 * @param {{ resumeType: "ORDER"|"WORKSHOP"|"FORMATION", resumeId: string, resumeToken: string }} params
 */
export async function retryCheckoutSession({ resumeType, resumeId, resumeToken } = {}) {
  const verified = verifyResumeCheckoutToken(resumeToken, { resumeType, resumeId });
  if (!verified.ok) {
    return {
      success: false,
      message: "Ce lien de reprise n'est plus valide. Veuillez vous connecter pour finaliser votre commande.",
    };
  }

  switch (resumeType) {
    case "ORDER":
      return resumeOrderAfterVerification(resumeId, resumeToken);
    case "WORKSHOP":
      return createWorkshopReservationCheckoutSession(resumeId, resumeToken);
    case "FORMATION":
      return createFormationReservationCheckoutSession(resumeId, resumeToken);
    default:
      return { success: false, message: "Type de réservation inconnu." };
  }
}
