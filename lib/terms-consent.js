import { z } from "zod";

// Bump whenever the CGV/CGU text a customer agrees to materially changes, so
// termsAcceptedVersion on older User rows stays an honest record of what they
// actually agreed to — mirrors lib/newsletter-consent.js#NEWSLETTER_CONSENT_VERSION.
export const TERMS_CONSENT_VERSION = "2026-08-12";

/**
 * Builds the Prisma `data` fragment recording that this person accepted the
 * CGV/CGU. Spread into the `user.create` call in registerUser and in the guest
 * checkout paths — never optional, the callers all validate
 * termsAccepted === true before this is reached.
 */
export function buildTermsAcceptanceUpdate() {
  return {
    termsAcceptedAt: new Date(),
    termsAcceptedVersion: TERMS_CONSENT_VERSION,
  };
}

/**
 * The `termsAccepted` field every customer-facing purchase schema shares.
 *
 * Consent used to be recorded at signup only. Every checkout form already
 * rendered a "j'accepte les CGV" checkbox, but the check lived entirely in the
 * client component: the server action — a public POST endpoint like every
 * "use server" export — accepted an order whether or not the box was ticked,
 * and persisted nothing either way. A guest who checked out without ever
 * registering therefore left no record of consent at all, which is precisely
 * what art. VI.45 §1 CDE requires the trader to be able to evidence.
 */
export const TERMS_CONSENT_REQUIRED_MESSAGE =
  "Vous devez accepter les conditions générales de vente pour continuer.";

// `error`, not `errorMap`: on Zod 4 errorMap is silently ignored and the
// customer would see "Invalid input: expected true" in English instead.
export const termsAcceptedSchema = z.literal(true, {
  error: TERMS_CONSENT_REQUIRED_MESSAGE,
});

/**
 * Stamps consent onto a customer who already has an account — a returning
 * guest, or someone who registered before this field existed.
 *
 * `updateMany` rather than `update` so a missing row is a no-op instead of a
 * throw, and gated so we only write when something actually changes: re-running
 * this on every order would otherwise keep resetting termsAcceptedAt, turning
 * "when did they first agree to these CGV" into "when did they last buy
 * anything". A newer version supersedes an older one — that is the whole point
 * of versioning the text.
 *
 * @param {object} client - prisma, or a transaction client
 * @param {string} userId
 */
export async function recordTermsAcceptance(client, userId) {
  if (!userId) return;
  await client.user.updateMany({
    where: {
      id: userId,
      OR: [
        { termsAcceptedAt: null },
        { termsAcceptedVersion: null },
        { termsAcceptedVersion: { not: TERMS_CONSENT_VERSION } },
      ],
    },
    data: buildTermsAcceptanceUpdate(),
  });
}
