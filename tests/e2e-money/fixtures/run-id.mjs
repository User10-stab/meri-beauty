/**
 * The tag that separates this run's money from everybody else's.
 *
 * Two shared resources make this necessary rather than tidy:
 *
 *   The dev database is shared with real dev data, so assertions must never
 *   sweep whole tables — a query like "the newest RefundOperation" would
 *   happily pick up a colleague's.
 *
 *   The Stripe test key is shared across every developer's machine. Stripe
 *   fans every event out to every listener, so a `charge.refunded` from
 *   someone else's terminal can land in the middle of an assertion. The
 *   deployment stamp in lib/stripe-deployment.js already covers
 *   checkout.session.* (it is machine-scoped, so localhost is not one shared
 *   identity), but charge.refunded carries no stamp at all and never can —
 *   a refund made by hand in the Stripe dashboard has none of our metadata.
 *
 * So every row this suite creates carries the run id, and every assertion
 * filters on it. A foreign event then becomes invisible rather than a flake.
 *
 * The id is generated once in global-setup and published through the
 * environment, because Playwright workers are separate processes and each
 * would otherwise mint its own.
 */

const ENV_KEY = "E2E_MONEY_RUN_ID";

/** Stripe metadata key. Sits alongside `appEnv`, never replacing it. */
export const RUN_METADATA_KEY = "e2eRunId";

/** Called once, by global-setup. */
export function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `e2e-${stamp}-${random}`;
}

/**
 * Deliberately throws rather than inventing one: an untagged row is a row
 * the purge script cannot find and the assertions cannot trust.
 */
export function getRunId() {
  const runId = (process.env[ENV_KEY] ?? "").trim();
  if (!runId) {
    throw new Error(
      `${ENV_KEY} is not set. The money suite must be started through ` +
        "playwright.money.config.mjs, whose globalSetup mints the run id.",
    );
  }
  return runId;
}

export function publishRunId(runId) {
  process.env[ENV_KEY] = runId;
}

/**
 * A deliverable-looking address on a domain that cannot receive mail, so a
 * misrouted message bounces locally instead of reaching a person. `.test` is
 * reserved by RFC 2606 for exactly this.
 */
export function taggedEmail(label, runId = getRunId()) {
  return `e2e+${label}.${runId}@meribeauty.test`;
}

/** The admin's written motive, which every refund path requires anyway. */
export function taggedReason(text, runId = getRunId()) {
  return `[${runId}] ${text}`;
}

export function runMetadata(runId = getRunId()) {
  return { [RUN_METADATA_KEY]: runId };
}
