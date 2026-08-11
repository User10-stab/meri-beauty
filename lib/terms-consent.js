// Bump whenever the CGV/CGU text a new customer agrees to at signup
// materially changes, so termsAcceptedVersion on older User rows stays an
// honest record of what they actually agreed to — mirrors
// lib/newsletter-consent.js#NEWSLETTER_CONSENT_VERSION.
export const TERMS_CONSENT_VERSION = "2026-08-11";

/**
 * Builds the Prisma `data` fragment recording that this person accepted the
 * CGV/CGU at account-creation time. Spread into the `user.create` call in
 * registerUser — never optional, registerSchema already requires
 * termsAccepted === true before this is ever reached.
 */
export function buildTermsAcceptanceUpdate() {
  return {
    termsAcceptedAt: new Date(),
    termsAcceptedVersion: TERMS_CONSENT_VERSION,
  };
}
