/**
 * Telling "this connected account is gone" apart from "Stripe is broken"
 * (2026-09-21).
 *
 * The reconciliation jobs sweep the platform account and then every
 * independent's connected account every five minutes. When one of those
 * accounts can no longer be read — the practitioner disconnected the app, the
 * account was rejected, or (in development) the key simply belongs to another
 * Stripe account than the ids in the database — Stripe answers 403
 * `account_invalid`.
 *
 * That is a permanent, expected state, not an incident. Reporting it through
 * captureCriticalError fired a fatal-level Sentry alert on every sweep, for
 * every affected account, forever: 90 of them in one afternoon of local
 * development. Alerts that always fire are alerts nobody reads, which is how
 * a real one gets missed.
 *
 * So these are downgraded to a warning and the account is skipped. Every
 * other Stripe failure still escalates, because those do mean something
 * broke.
 */

/**
 * @param {unknown} error
 * @returns {boolean} true when this account cannot be read at all, and
 *   retrying it on the next sweep will fail identically.
 */
export function isStripeAccountUnavailable(error) {
  if (!error || typeof error !== "object") return false;
  const code = /** @type {{ code?: string }} */ (error).code;
  const type = /** @type {{ type?: string }} */ (error).type;
  const status = /** @type {{ statusCode?: number }} */ (error).statusCode;

  // The explicit signal Stripe documents for a revoked or unknown account.
  if (code === "account_invalid") return true;
  // A permission error on a connected account is the same situation even when
  // Stripe words the code differently.
  if (type === "StripePermissionError" && status === 403) return true;
  return false;
}
